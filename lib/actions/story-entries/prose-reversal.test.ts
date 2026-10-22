import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, happenings, stories, type ClassifierStatus } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  definePipeline,
  pipelineEventBus,
  startPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
  type PipelineEvent,
} from '@/lib/pipeline'
import { makeHarness, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import { generationStore, interruptMemoryRuns, type DeferredWorkKind } from '@/lib/stores'

import { bracketProseReversal, classifierWatermarkClampOps } from './prose-reversal'
import { __resetBranchWriteLocks, withBranchWriteShared } from '../delta/branch-write-lock'

describe('bracketProseReversal', () => {
  beforeEach(() => {
    generationStore.__reset()
    __resetBranchWriteLocks()
  })

  it('sets reversalInProgress across the body and clears it after', async () => {
    const seen: boolean[] = []
    await bracketProseReversal('branch_1', async () => {
      seen.push(generationStore.getTxState().reversalInProgress)
    })
    expect(seen).toEqual([true])
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })

  it('clears reversalInProgress even when the body throws', async () => {
    await expect(
      bracketProseReversal('branch_1', async () => {
        throw new Error('sweep failed')
      }),
    ).rejects.toThrow('sweep failed')
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })

  // A rollback preview selects its set under a shared hold across several reads; a reversal
  // committing between them refuses the preview as an integrity fault.
  it("runs the body only once a rollback preview's shared hold settles", async () => {
    const order: string[] = []
    let endPreview!: () => void
    const preview = withBranchWriteShared(
      'branch_1',
      'rollback-preview',
      () =>
        new Promise<void>((resolve) => {
          endPreview = () => {
            order.push('preview done')
            resolve()
          }
        }),
    )
    const done = bracketProseReversal('branch_1', async () => {
      order.push('swept')
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual([])

    endPreview()
    await Promise.all([preview, done])
    expect(order).toEqual(['preview done', 'swept'])
  })

  it('keeps a preview starting mid-reversal out until the body settles', async () => {
    const order: string[] = []
    let preview: Promise<void> | undefined
    await bracketProseReversal('branch_1', async () => {
      preview = withBranchWriteShared('branch_1', 'rollback-preview', async () => {
        order.push('preview')
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('swept')
    })
    await preview
    expect(order).toEqual(['swept', 'preview'])
  })

  it('releases the hold when the body throws', async () => {
    await expect(
      bracketProseReversal('branch_1', async () => {
        throw new Error('sweep failed')
      }),
    ).rejects.toThrow('sweep failed')

    let ran = false
    await withBranchWriteShared('branch_1', 'rollback-preview', async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('rejects a nested bracket rather than silently dropping the barrier', async () => {
    await expect(
      bracketProseReversal('branch_1', async () => {
        await bracketProseReversal('branch_1', async () => {})
      }),
    ).rejects.toThrow('not re-entrant')
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })
})

// generation-pipeline.md → Prose reversals and the interrupt.
describe('bracketProseReversal — the interrupt', () => {
  beforeEach(() => {
    resetSingletons()
  })
  afterEach(() => {
    resetSingletons()
  })

  // An interruptible stand-in: it writes one fact, then waits until it is cancelled.
  function defineInterruptible(
    kind: string,
    slot: DeferredWorkKind,
    onAbort: () => void = () => {},
  ): { landed: Promise<void> } {
    let land!: () => void
    const landed = new Promise<void>((resolve) => {
      land = resolve
    })
    async function* writeThenWait(
      ctx: PhaseContext,
    ): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
      yield {
        type: 'delta_emitted',
        action: {
          kind: 'createHappening',
          source: 'periodic_classifier',
          payload: {
            entry: {
              id: `hap_${ctx.actionId}`,
              branchId: ctx.branchId,
              title: 'A fact',
              createdAt: 1,
              updatedAt: 1,
            },
          },
        },
      }
      land()
      await new Promise<void>((resolve) => {
        if (ctx.abortSignal.aborted) {
          resolve()
        } else {
          ctx.abortSignal.addEventListener(
            'abort',
            () => {
              onAbort()
              resolve()
            },
            { once: true },
          )
        }
      })
      return { status: 'aborted' }
    }
    definePipeline({
      kind,
      phases: [{ name: 'run', run: writeThenWait }],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      interruptible: slot,
      concurrencyPolicy: {},
    })
    return { landed }
  }

  it('interrupts a pass in flight before the body, reversing its writes and deferring it', async () => {
    const { db, ctx } = await makeHarness()
    const flagAtAbort: boolean[] = []
    const { landed } = defineInterruptible(PERIODIC_CLASSIFIER_KIND, 'pass', () =>
      flagAtAbort.push(generationStore.getTxState().reversalInProgress),
    )
    const deferrals: PipelineEvent[] = []
    const off = pipelineEventBus.subscribe('run_deferred', (e) => deferrals.push(e))
    const pass = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed
    expect(await db.select().from(happenings)).toHaveLength(1)

    const [run] = [...generationStore.getTxState().runs.values()]
    const seen: unknown[] = []
    const bracket = bracketProseReversal('b1', async () => {
      const txState = generationStore.getTxState()
      seen.push({
        runs: txState.runs.size,
        deferred: txState.deferred.get('b1'),
        facts: (await db.select().from(happenings)).length,
      })
    })
    // The order is flag, interrupt, settle: the abort is out before the bracket's first await.
    expect(run.abortController.signal.aborted).toBe(true)
    await bracket
    off()

    // The flag is up before the interrupt, so no pass can start between it and the sweep.
    expect(flagAtAbort).toEqual([true])
    expect(seen).toEqual([{ runs: 0, deferred: { pass: true }, facts: 0 }])
    expect(await pass.origin).toMatchObject({ outcome: 'aborted' })
    await pass.chain
    expect(deferrals).toEqual([
      expect.objectContaining({
        type: 'run_deferred',
        kind: PERIODIC_CLASSIFIER_KIND,
        branchId: 'b1',
        work: 'pass',
      }),
    ])
  })

  it('interrupts a chapter close the same way, recording a deferred close', async () => {
    const { ctx } = await makeHarness()
    const { landed } = defineInterruptible('chapter-close', 'close')
    const close = startPipeline('chapter-close', ctx)
    await landed

    let deferredInBody: unknown
    await bracketProseReversal('b1', async () => {
      deferredInBody = generationStore.getTxState().deferred.get('b1')
    })

    expect(deferredInBody).toEqual({ close: true })
    expect(await close.origin).toMatchObject({ outcome: 'aborted' })
  })

  it('runs the body at once and records nothing when no pass is in flight', async () => {
    await makeHarness()
    const deferrals: PipelineEvent[] = []
    const off = pipelineEventBus.subscribe('run_deferred', (e) => deferrals.push(e))
    let ran = false

    await bracketProseReversal('b1', async () => {
      ran = true
    })
    off()

    expect(ran).toBe(true)
    expect(generationStore.getTxState().deferred.size).toBe(0)
    expect(deferrals).toEqual([])
  })

  it('leaves an interruptible run on another branch running', async () => {
    const { db, ctx } = await makeHarness()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'alt', createdAt: 1 })
    const { landed } = defineInterruptible(PERIODIC_CLASSIFIER_KIND, 'pass')
    const other = startPipeline(PERIODIC_CLASSIFIER_KIND, { ...ctx, branchId: 'b2' })
    await landed
    const [run] = [...generationStore.getTxState().runs.values()]

    await bracketProseReversal('b1', async () => {})

    expect(run.abortController.signal.aborted).toBe(false)
    expect(generationStore.getTxState().runs.has(run.runId)).toBe(true)
    expect(generationStore.getTxState().deferred.size).toBe(0)

    await interruptMemoryRuns('b2')
    expect(await other.origin).toMatchObject({ outcome: 'aborted' })
    await other.chain
  })
})

describe('classifierWatermarkClampOps', () => {
  async function seedBranch(status: ClassifierStatus | null) {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db
      .insert(branches)
      .values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1, classifierStatus: status })
    const read = async () =>
      (await db.select().from(branches).where(eq(branches.id, 'b1')))[0].classifierStatus
    return { runInTransaction, read }
  }

  const status = (processedThrough: number | null): ClassifierStatus => ({
    state: 'failed',
    lastSuccessAt: 111,
    lastError: 'boom',
    processedThrough,
  })

  it('clamps to position(B) - 1, leaving the other keys of the blob intact', async () => {
    const { runInTransaction, read } = await seedBranch(status(9))
    await runInTransaction(classifierWatermarkClampOps('b1', 5))
    expect(await read()).toEqual({ ...status(9), processedThrough: 4 })
  })

  it('no-ops when the watermark is already at or below the clamp', async () => {
    const { runInTransaction, read } = await seedBranch(status(2))
    await runInTransaction(classifierWatermarkClampOps('b1', 5))
    expect(await read()).toEqual(status(2))
  })

  it('no-ops when the branch has no classifier status yet', async () => {
    const { runInTransaction, read } = await seedBranch(null)
    await runInTransaction(classifierWatermarkClampOps('b1', 5))
    expect(await read()).toBeNull()
  })
})
