import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type PipelineAction } from '@/lib/actions'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { deltas, storyEntries } from '@/lib/db'
import {
  definePipeline,
  pipelineEventBus,
  startPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
  type PipelineEvent,
  type PipelineStart,
  type RunCtx,
} from '@/lib/pipeline'
import { awaitRunTerminal, generationStore, interruptMemoryRuns } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

let entrySeq = 0
let onHold: (finish: (result: PhaseResult) => void) => void = () => {}

function createEntry(id: string): { type: 'delta_emitted'; action: PipelineAction } {
  return {
    type: 'delta_emitted',
    action: {
      kind: 'createStoryEntry',
      source: 'periodic_classifier',
      payload: {
        entry: { id, branchId: 'b1', position: 1, kind: 'ai_reply', content: id, createdAt: 1 },
      },
    },
  }
}

async function* writesThenHolds({
  abortSignal,
}: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  yield createEntry(`entry_${++entrySeq}`)
  const result = await new Promise<PhaseResult>((resolve) => {
    if (abortSignal.aborted) return resolve({ status: 'aborted' })
    abortSignal.addEventListener('abort', () => resolve({ status: 'aborted' }), { once: true })
    onHold(resolve)
  })
  return result
}

function defineStandIn(kind: string, interruptible = true): void {
  definePipeline({
    kind,
    phases: [{ name: 'pass', run: writesThenHolds }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    interruptible,
    concurrencyPolicy: { blockedBy: [kind] },
  })
}

async function startHeld(
  kind: string,
  ctx: RunCtx,
): Promise<{ start: PipelineStart; finish: (result: PhaseResult) => void }> {
  let finish!: (result: PhaseResult) => void
  const holding = new Promise<void>((resolve) => {
    onHold = (f) => {
      finish = f
      resolve()
    }
  })
  const start = startPipeline(kind, ctx)
  await holding
  return { start, finish }
}

type Seen = Extract<PipelineEvent, { type: 'run_complete' | 'run_deferred' }>

function recordTerminalEvents(): Seen[] {
  const seen: Seen[] = []
  pipelineEventBus.subscribeAll((e) => {
    if (e.type === 'run_complete' || e.type === 'run_deferred') seen.push(e)
  })
  return seen
}

const deferredOnB1 = () => generationStore.getTxState().deferred.get('b1')

function defineChainingTurn(): void {
  definePipeline({
    kind: 'origin-turn',
    phases: [
      {
        name: 'turn',
        run: async function* (): AsyncGenerator<never, PhaseResult> {
          return { status: 'completed' }
        },
      },
    ],
    affordance: 'pill-only',
    gateBehavior: 'hard-gate',
    concurrencyPolicy: {},
    chainsTo: () => PERIODIC_CLASSIFIER_KIND,
  })
}

// Interrupts the pass in the store update that swaps it in at the turn's commit, before it starts.
async function runInterruptedAtSwap(ctx: RunCtx): Promise<boolean> {
  let interrupted: Promise<void> | undefined
  const off = generationStore.subscribe(() => {
    const runs = [...generationStore.getTxState().runs.values()]
    if (!interrupted && runs.some((r) => r.kind === PERIODIC_CLASSIFIER_KIND))
      interrupted = interruptMemoryRuns('b1')
  })
  try {
    const start = startPipeline('origin-turn', ctx)
    expect(expectRan(await start.origin).outcome).toBe('completed')
    await start.chain
    await interrupted
  } finally {
    off()
  }
  return interrupted !== undefined
}

describe('deferred work', () => {
  beforeEach(() => {
    resetSingletons()
    entrySeq = 0
  })
  afterEach(() => resetSingletons())

  it('records an interrupted pass, reverses its writes and emits run_deferred after run_complete', async () => {
    const { db, ctx } = await makeHarness()
    defineStandIn(PERIODIC_CLASSIFIER_KIND)
    const seen = recordTerminalEvents()

    const { start } = await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    const [held] = generationStore.getTxState().runs.values()
    expect(held.interruptible).toBe(true)
    expect(await db.select().from(storyEntries)).toHaveLength(1)

    await interruptMemoryRuns('b1')

    // The interrupt's waiter sees the record and the event once the terminal resolves.
    expect(deferredOnB1()).toEqual({ pass: true })
    expect(seen.map((e) => e.type)).toEqual(['run_complete', 'run_deferred'])
    expect(seen[1]).toEqual({
      type: 'run_deferred',
      runId: held.runId,
      kind: PERIODIC_CLASSIFIER_KIND,
      branchId: 'b1',
      work: 'pass',
    })
    const tx = expectRan(await start.origin)
    expect(tx.outcome).toBe('aborted')
    expect(tx.runId).toBe(held.runId)
    expect(await db.select().from(storyEntries)).toHaveLength(0)
    expect(await db.select().from(deltas)).toHaveLength(0)
  })

  it('defers a pass interrupted at the swap from its predecessor, once', async () => {
    const { db, ctx } = await makeHarness()
    defineStandIn(PERIODIC_CLASSIFIER_KIND)
    defineChainingTurn()
    const seen = recordTerminalEvents()

    expect(await runInterruptedAtSwap(ctx)).toBe(true)

    expect(deferredOnB1()).toEqual({ pass: true })
    expect(seen.filter((e) => e.type === 'run_deferred')).toHaveLength(1)
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(await db.select().from(storyEntries)).toHaveLength(0)
  })

  // No classifier profile is set, so this pass's pre-flight would fail and its hook burn a retry.
  describe('a pass cancelled before its pre-flight', () => {
    let preflightHookCalls = 0
    let phaseEntered = false

    beforeEach(() => {
      preflightHookCalls = 0
      phaseEntered = false
      definePipeline({
        kind: PERIODIC_CLASSIFIER_KIND,
        phases: [
          {
            name: 'pass',
            run: async function* (): AsyncGenerator<never, PhaseResult> {
              phaseEntered = true
              return { status: 'completed' }
            },
            resolves: [{ target: 'classifier' }],
          },
        ],
        affordance: 'pill-and-banner',
        gateBehavior: 'hard-gate',
        interruptible: true,
        concurrencyPolicy: { blockedBy: [PERIODIC_CLASSIFIER_KIND] },
        onPreflightFailure: async () => {
          preflightHookCalls++
        },
      })
    })

    const passComplete = (seen: Seen[]) =>
      seen.find((e) => e.type === 'run_complete' && e.kind === PERIODIC_CLASSIFIER_KIND)

    it('is interrupted, not failed, when cancelled at the swap from its predecessor', async () => {
      const { ctx } = await makeHarness()
      defineChainingTurn()
      const seen = recordTerminalEvents()

      expect(await runInterruptedAtSwap(ctx)).toBe(true)

      expect(passComplete(seen)).toMatchObject({ outcome: 'aborted' })
      expect(preflightHookCalls).toBe(0)
      expect(phaseEntered).toBe(false)
      expect(deferredOnB1()).toEqual({ pass: true })
      expect(seen.filter((e) => e.type === 'run_deferred')).toHaveLength(1)
    })

    it("keeps a Send's deferred pass deferred when cancelled as it reserves", async () => {
      const { ctx } = await makeHarness()
      const seen = recordTerminalEvents()

      const start = startPipeline(PERIODIC_CLASSIFIER_KIND, {
        ...ctx,
        beforeTurn: true,
        onReserved: () => void interruptMemoryRuns('b1'),
      })

      expect(expectRan(await start.origin).outcome).toBe('aborted')
      expect(preflightHookCalls).toBe(0)
      expect(phaseEntered).toBe(false)
      expect(deferredOnB1()).toEqual({ pass: true })
      expect(passComplete(seen)).toMatchObject({ outcome: 'aborted' })
    })
  })

  it('emits nothing new when work already deferred is aborted again', async () => {
    const { ctx } = await makeHarness()
    defineStandIn(PERIODIC_CLASSIFIER_KIND)
    const seen = recordTerminalEvents()
    await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    await interruptMemoryRuns('b1')
    expect(deferredOnB1()).toEqual({ pass: true })

    const { start } = await startHeld(PERIODIC_CLASSIFIER_KIND, { ...ctx, beforeTurn: true })
    await interruptMemoryRuns('b1')

    expect(expectRan(await start.origin).outcome).toBe('aborted')
    expect(deferredOnB1()).toEqual({ pass: true })
    expect(seen.filter((e) => e.type === 'run_deferred')).toHaveLength(1)
  })

  it('clears the record when the pass commits', async () => {
    const { ctx } = await makeHarness()
    defineStandIn(PERIODIC_CLASSIFIER_KIND)
    await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    await interruptMemoryRuns('b1')
    expect(deferredOnB1()).toEqual({ pass: true })

    const { start, finish } = await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    finish({ status: 'completed' })

    expect(expectRan(await start.origin).outcome).toBe('completed')
    expect(generationStore.getTxState().deferred.has('b1')).toBe(false)
  })

  it('clears the record when the pass fails, without a new run_deferred', async () => {
    const { ctx } = await makeHarness()
    defineStandIn(PERIODIC_CLASSIFIER_KIND)
    const seen = recordTerminalEvents()
    await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    await interruptMemoryRuns('b1')
    expect(deferredOnB1()).toEqual({ pass: true })

    const { start, finish } = await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    finish({ status: 'failed', error: { kind: 'phase-logic', detail: 'pass failed' } })

    expect(expectRan(await start.origin).outcome).toBe('failed')
    expect(generationStore.getTxState().deferred.has('b1')).toBe(false)
    expect(seen.filter((e) => e.type === 'run_deferred')).toHaveLength(1)
  })

  // A cancel whose reversal fails settles as 'failed': its writes are still on disk, so the next
  // Send must not run the pass on top of them.
  it('records nothing and emits no run_deferred when the interrupted pass cannot be reversed', async () => {
    const { ctx } = await makeHarness()
    definePipeline({
      kind: PERIODIC_CLASSIFIER_KIND,
      phases: [
        {
          name: 'pass',
          run: async function* (phase: PhaseContext): AsyncGenerator<never, PhaseResult> {
            // target_table resolves through the runtime registry, so an unregistered name makes
            // this run's own reversal throw for real.
            await phase.db.insert(deltas).values({
              id: 'd_poison',
              branchId: 'b1',
              entryId: null,
              actionId: phase.actionId,
              logPosition: 900,
              source: 'ai_classifier',
              targetTable: 'not_a_registered_table',
              targetId: 'x',
              op: 'create',
              undoPayload: null,
              encodingVersion: 1,
              createdAt: 1,
            })
            return await new Promise<PhaseResult>((resolve) => {
              phase.abortSignal.addEventListener('abort', () => resolve({ status: 'aborted' }), {
                once: true,
              })
              onHold(resolve)
            })
          },
        },
      ],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      interruptible: true,
      concurrencyPolicy: { blockedBy: [PERIODIC_CLASSIFIER_KIND] },
    })
    const seen = recordTerminalEvents()

    const { start } = await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    await interruptMemoryRuns('b1')

    const tx = expectRan(await start.origin)
    expect(tx.outcome).toBe('failed')
    expect(tx.error?.detail).toMatch(/^reverse-replay failed/)
    expect(generationStore.getTxState().deferred.size).toBe(0)
    expect(seen.map((e) => e.type)).toEqual(['run_complete'])
  })

  it('records an interrupted close in its own slot and names it on run_deferred', async () => {
    const { ctx } = await makeHarness()
    defineStandIn('chapter-close')
    const seen = recordTerminalEvents()

    const { start } = await startHeld('chapter-close', ctx)
    await interruptMemoryRuns('b1')

    expect(expectRan(await start.origin).outcome).toBe('aborted')
    expect(deferredOnB1()).toEqual({ close: true })
    expect(seen.filter((e) => e.type === 'run_deferred')).toEqual([
      expect.objectContaining({ kind: 'chapter-close', work: 'close' }),
    ])
  })

  it('records nothing for an interruptible run of a kind that maps to no deferred work', async () => {
    const { ctx } = await makeHarness()
    defineStandIn('other-interruptible')
    const seen = recordTerminalEvents()

    const { start } = await startHeld('other-interruptible', ctx)
    await interruptMemoryRuns('b1')

    expect(expectRan(await start.origin).outcome).toBe('aborted')
    expect(generationStore.getTxState().deferred.size).toBe(0)
    expect(seen.map((e) => e.type)).toEqual(['run_complete'])
  })

  it('records nothing for a pass-kind run that is not interruptible', async () => {
    const { ctx } = await makeHarness()
    defineStandIn(PERIODIC_CLASSIFIER_KIND, false)
    const seen = recordTerminalEvents()

    const { start } = await startHeld(PERIODIC_CLASSIFIER_KIND, ctx)
    expect([...generationStore.getTxState().runs.values()][0].interruptible).toBe(false)
    await awaitRunTerminal(PERIODIC_CLASSIFIER_KIND, 'b1', 'cancel')

    expect(expectRan(await start.origin).outcome).toBe('aborted')
    expect(generationStore.getTxState().deferred.size).toBe(0)
    expect(seen.map((e) => e.type)).toEqual(['run_complete'])
  })
})
