import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withBranchWriteShared } from '@/lib/actions/delta/branch-write-lock'
import { DeltaReplayError } from '@/lib/actions/delta/replay-errors'
import { reverseRunGroup } from '@/lib/actions/delta/rerun-journal'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, happenings } from '@/lib/db'
import {
  configureDeltaActionPort,
  definePipeline,
  startPipeline,
  type DeltaActionPort,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
  pipelineErrorDetail,
  pipelineEventBus,
} from '@/lib/pipeline'
import { generationStore, RERUN_HELD, type RunSlot } from '@/lib/stores'

import { makeHarness, realDeltaActionPort, resetSingletons } from './harness'

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// A hold that never ends fails with a name, not by vitest's timeout.
async function within<T>(promise: Promise<T>, what: string, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: still pending after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function configurePort(over: Partial<DeltaActionPort>): void {
  configureDeltaActionPort({ ...realDeltaActionPort(), ...over })
}

const grantedWithin = (what: string) =>
  within(
    withBranchWriteShared('b1', 'probe', async () => 'granted' as const),
    what,
  )

function defineRun(kind: string, slot?: RunSlot): { landed: Promise<void> } {
  let land!: () => void
  const landed = new Promise<void>((resolve) => {
    land = resolve
  })
  async function* writeThenWait(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
    yield {
      type: 'delta_emitted',
      action: {
        kind: 'createHappening',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: 'hap_run',
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
      if (ctx.abortSignal.aborted) resolve()
      else ctx.abortSignal.addEventListener('abort', () => resolve(), { once: true })
    })
    return { status: 'aborted' }
  }
  definePipeline({
    kind,
    phases: [{ name: 'run', run: writeThenWait }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    ...(slot === 'rerun' ? { runSlot: () => slot } : { interruptible: slot }),
    concurrencyPolicy: {},
  })
  return { landed }
}

function abortRuns(): void {
  for (const run of generationStore.getTxState().runs.values()) run.abortController.abort()
}

function openPreview(): { end: () => void; done: Promise<void> } {
  let end!: () => void
  const done = withBranchWriteShared(
    'b1',
    'rollback-preview',
    () =>
      new Promise<void>((resolve) => {
        end = resolve
      }),
  )
  return { end: () => end(), done }
}

// generation-pipeline.md → Branch write lock: no reversal lands between a preview's reads.
describe("an interruptible run's abort reversal and the branch write lock", () => {
  beforeEach(() => {
    resetSingletons()
  })
  afterEach(() => {
    resetSingletons()
  })

  it('waits for a preview in progress before it reverses', async () => {
    const { db, ctx } = await makeHarness()
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed
    const preview = openPreview()

    abortRuns()
    await pause(20)
    expect(await db.select().from(happenings)).toHaveLength(1)

    preview.end()
    await within(preview.done, 'preview')
    expect(await within(run.origin, 'abort')).toMatchObject({ outcome: 'aborted' })
    expect(await db.select().from(happenings)).toEqual([])
  })

  it('keeps a preview that starts during the reversal out until it commits', async () => {
    const { db, ctx } = await makeHarness()
    let entered!: () => void
    const reversing = new Promise<void>((resolve) => {
      entered = resolve
    })
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const slowReverse: DeltaActionPort['reverseRunGroup'] = async (...args) => {
      entered()
      await finished
      return reverseRunGroup(...args)
    }
    configurePort({ reverseRunGroup: slowReverse })
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed

    abortRuns()
    await reversing
    const seen: number[] = []
    const preview = withBranchWriteShared('b1', 'rollback-preview', async () => {
      seen.push((await db.select().from(happenings)).length)
    })
    await pause(20)
    expect(seen).toEqual([])

    finish()
    await within(run.origin, 'abort')
    await within(preview, 'preview')
    expect(seen).toEqual([0])
  })

  it('takes no hold for a run that is not interruptible', async () => {
    const { db, ctx } = await makeHarness()
    const { landed } = defineRun('turn-stand-in')
    const run = startPipeline('turn-stand-in', ctx)
    await landed
    const preview = openPreview()

    abortRuns()
    expect(await within(run.origin, 'abort behind a preview')).toMatchObject({
      outcome: 'aborted',
    })
    expect(await db.select().from(happenings)).toEqual([])

    preview.end()
    await within(preview.done, 'preview')
  })

  // A leaked exclusive hold stalls every write to the branch until boot.
  it('releases the hold when the reversal fails and boot recovery owns the run', async () => {
    const { ctx } = await makeHarness()
    configurePort({
      reverseRunGroup: ({ actionId }) =>
        Promise.reject(
          new DeltaReplayError('Reverse-replay failed', {
            cause: new Error('forced'),
            actionId,
            stage: 'transaction',
          }),
        ),
    })
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed

    abortRuns()
    expect(await within(run.origin, 'abort')).toMatchObject({ outcome: 'failed' })
    expect(await grantedWithin('a write after the failed reversal')).toBe('granted')
  })

  it('releases the hold when the reversal throws something the orchestrator does not recognise', async () => {
    const { ctx } = await makeHarness()
    configurePort({ reverseRunGroup: () => Promise.reject(new Error('not a replay error')) })
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed

    const completes: { outcome: string; detail?: string }[] = []
    pipelineEventBus.subscribe('run_complete', (e) => {
      completes.push({
        outcome: e.outcome,
        detail: e.error !== undefined ? pipelineErrorDetail(e.error) : undefined,
      })
    })
    abortRuns()
    // generation-pipeline.md → Run state transitions: every abort ends the run, so the gate drops
    // and the reader hears of the failure; recovery owns the writes, as for a failed reversal.
    expect(await within(run.origin, 'abort')).toMatchObject({ outcome: 'failed' })
    expect(completes).toEqual([
      { outcome: 'failed', detail: 'reverse-replay failed: not a replay error' },
    ])
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(await grantedWithin('a write after the thrown reversal')).toBe('granted')
  })
})

// generation-pipeline.md → Reverse-replay: a re-run whose journal couldn't be written back says so.
describe("an abort's journal outcome", () => {
  beforeEach(() => {
    resetSingletons()
  })
  afterEach(() => {
    resetSingletons()
  })

  async function abortWith(reverse: DeltaActionPort['reverseRunGroup']): Promise<unknown> {
    const { ctx } = await makeHarness()
    configurePort({ reverseRunGroup: reverse })
    const { landed } = defineRun('rerun-stand-in')
    const run = startPipeline('rerun-stand-in', ctx)
    await landed
    abortRuns()
    return within(run.origin, 'abort')
  }

  it('asks for the run group by its action and branch', async () => {
    const asked: unknown[] = []
    await abortWith(async (args) => {
      asked.push(args)
      return { deltas: 0, journal: null }
    })

    expect(asked).toEqual([{ actionId: expect.any(String), branchId: 'b1' }])
  })

  it('marks the aborted run closeUndone when its reversal undid the close', async () => {
    expect(
      await abortWith(async () => ({ deltas: 2, journal: 'undone', chapterNumber: 3 })),
    ).toMatchObject({ outcome: 'aborted', closeUndone: true })
  })

  it.each([
    ['restored', { deltas: 2, journal: 'restored' }],
    ['with no journal', { deltas: 1, journal: null }],
  ] as const)(
    'leaves an aborted run unmarked when its reversal ended %s',
    async (_name, reversal) => {
      const result = await abortWith(async () => reversal)

      expect(result).toMatchObject({ outcome: 'aborted' })
      expect(result).not.toHaveProperty('closeUndone')
    },
  )

  it('marks a failed run closeUndone when only the store sync after an undone close failed', async () => {
    const result = await abortWith(({ actionId }) =>
      Promise.reject(
        new DeltaReplayError('Post-commit patch sync failed', {
          cause: new Error('store sync boom'),
          actionId,
          stage: 'store-sync',
          rerun: { journal: 'undone', chapterNumber: 3 },
        }),
      ),
    )

    expect(result).toMatchObject({
      outcome: 'failed',
      closeUndone: true,
      error: {
        kind: 'orchestrator',
        detail: 'post-commit store sync failed: Error: store sync boom',
      },
    })
  })

  it('leaves a failed run unmarked when its reversal never committed', async () => {
    const result = await abortWith(({ actionId }) =>
      Promise.reject(
        new DeltaReplayError('Reverse-replay failed', {
          cause: new Error('forced'),
          actionId,
          stage: 'transaction',
        }),
      ),
    )

    expect(result).toMatchObject({ outcome: 'failed' })
    expect(result).not.toHaveProperty('closeUndone')
  })

  it.each([
    ['a restored journal', { rerun: { journal: 'restored' } }],
    ['no journal', {}],
  ] as const)(
    'leaves a failed run unmarked when only the store sync failed after %s',
    async (_name, payload) => {
      const result = await abortWith(({ actionId }) =>
        Promise.reject(
          new DeltaReplayError('Post-commit patch sync failed', {
            cause: new Error('store sync boom'),
            actionId,
            stage: 'store-sync',
            ...payload,
          }),
        ),
      )

      expect(result).toMatchObject({
        outcome: 'failed',
        error: {
          kind: 'orchestrator',
          detail: 'post-commit store sync failed: Error: store sync boom',
        },
      })
      expect(result).not.toHaveProperty('closeUndone')
    },
  )
})

// generation-pipeline.md → Recovery-failure policy: a re-run's abort that couldn't take itself back
// holds its branch until a restart; the writes it left are boot recovery's to reverse.
describe("an abort whose reversal didn't commit", () => {
  beforeEach(() => {
    resetSingletons()
  })
  afterEach(() => {
    resetSingletons()
  })

  const UNCOMMITTED: DeltaActionPort['reverseRunGroup'] = ({ actionId }) =>
    Promise.reject(
      new DeltaReplayError('Reverse-replay failed', {
        cause: new Error('forced'),
        actionId,
        stage: 'transaction',
      }),
    )

  const STORE_SYNC: DeltaActionPort['reverseRunGroup'] = ({ actionId }) =>
    Promise.reject(
      new DeltaReplayError('Post-commit patch sync failed', {
        cause: new Error('store sync boom'),
        actionId,
        stage: 'store-sync',
      }),
    )

  async function abortWith(
    reverse: DeltaActionPort['reverseRunGroup'],
    slot: 'rerun' | 'pass',
  ): Promise<unknown> {
    const { ctx } = await makeHarness()
    configurePort({ reverseRunGroup: reverse })
    const kind = slot === 'rerun' ? 'rerun-stand-in' : PERIODIC_CLASSIFIER_KIND
    const { landed } = defineRun(kind, slot)
    const run = startPipeline(kind, ctx)
    await landed
    abortRuns()
    return within(run.origin, 'abort')
  }

  const held = () => generationStore.getTxState().heldBranches.has('b1')

  it("marks the run unreversed and holds a re-run's branch", async () => {
    const result = await abortWith(UNCOMMITTED, 'rerun')

    expect(result).toMatchObject({ outcome: 'failed', unreversed: true })
    expect(held()).toBe(true)
  })

  it('marks a pass unreversed but holds nothing', async () => {
    const result = await abortWith(UNCOMMITTED, 'pass')

    expect(result).toMatchObject({ outcome: 'failed', unreversed: true })
    expect(held()).toBe(false)
  })

  it('neither marks nor holds a re-run whose reversal committed before its store sync failed', async () => {
    const result = await abortWith(STORE_SYNC, 'rerun')

    expect(result).toMatchObject({ outcome: 'failed' })
    expect(result).not.toHaveProperty('unreversed')
    expect(held()).toBe(false)
  })

  it('refuses every start on the held branch, reserving nothing, and starts one on another', async () => {
    await abortWith(UNCOMMITTED, 'rerun')
    const { ctx } = await makeHarness()
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'other', createdAt: 1 })
    defineRun('later-run')

    const refused = await within(startPipeline('later-run', ctx).origin, 'a start on b1')
    expect(refused).toEqual({ outcome: 'rejected', blockedBy: RERUN_HELD })
    expect(generationStore.getTxState().runs.size).toBe(0)

    const elsewhere = startPipeline('later-run', { ...ctx, branchId: 'b2' })
    expect(generationStore.getTxState().runs.size).toBe(1)
    abortRuns()
    await within(elsewhere.origin, 'a start on b2')
  })
})
