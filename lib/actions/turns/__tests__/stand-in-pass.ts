import { desc, eq } from 'drizzle-orm'

import { idleStatus, PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, storyEntries } from '@/lib/db'
import {
  PER_TURN_KIND,
  pipelineEventBus,
  registerPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
  type PipelineEvent,
} from '@/lib/pipeline'
import { generationStore, type RunState } from '@/lib/stores'

/** One run of the stand-in pass, holding after its write. */
export type HeldPass = {
  readonly actionId: string
  readonly beforeTurn: boolean
  /** `completed` keeps the write and advances the watermark; `failed` reverses it. */
  finish: (outcome: 'completed' | 'failed') => void
}

export type StandInPass = {
  /** The next run once its write has committed and it holds; runs already holding come first. */
  nextHeld: () => Promise<HeldPass>
  /** Every run that reached its hold, in order. */
  readonly runs: readonly HeldPass[]
}

export type StandInPassOptions = {
  /** `entry_id` of the run's one write, a happening named by `standInHappeningId`. */
  anchorEntryId: string | null
  /** Runs inside the phase once the abort lands, before the phase returns `aborted`. */
  onAbort?: (ctx: PhaseContext) => Promise<void>
}

export type RunDeferredEvent = Extract<PipelineEvent, { type: 'run_deferred' }>

export function standInHappeningId(actionId: string): string {
  return `hap_${actionId}`
}

/**
 * Interruptible hard-gate pipeline under the pass's kind, so its abort records a deferral.
 * Register before `ensurePeriodicClassifierPipelineRegistered`, which only fills a missing kind.
 */
export function registerStandInPass(options: StandInPassOptions): StandInPass {
  const runs: HeldPass[] = []
  const ready: HeldPass[] = []
  const waiting: ((run: HeldPass) => void)[] = []

  async function* phase(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    const id = standInHappeningId(ctx.actionId)
    yield {
      type: 'delta_emitted',
      action: {
        kind: 'createHappening',
        source: 'periodic_classifier',
        payload: { entry: { id, branchId: ctx.branchId, title: id, createdAt: 1, updatedAt: 1 } },
      },
      entryId: options.anchorEntryId,
    }
    const beforeTurn = [...generationStore.getTxState().runs.values()].some(
      (r) => r.actionId === ctx.actionId && r.beforeTurn,
    )
    const outcome = await new Promise<'completed' | 'failed' | 'aborted'>((resolve) => {
      if (ctx.abortSignal.aborted) {
        resolve('aborted')
        return
      }
      ctx.abortSignal.addEventListener('abort', () => resolve('aborted'), { once: true })
      const run: HeldPass = { actionId: ctx.actionId, beforeTurn, finish: resolve }
      runs.push(run)
      const waiter = waiting.shift()
      if (waiter) waiter(run)
      else ready.push(run)
    })
    if (outcome === 'aborted') {
      await options.onAbort?.(ctx)
      return { status: 'aborted' }
    }
    if (outcome === 'failed')
      return { status: 'failed', error: { kind: 'phase-logic', detail: 'stand-in pass failed' } }
    await advanceWatermark(ctx)
    return { status: 'completed' }
  }

  // Mirrors the real pass's gate, interruptible flag and blockedBy (periodic-classifier.ts).
  registerPipeline({
    kind: PERIODIC_CLASSIFIER_KIND,
    phases: [{ name: 'classify', run: phase }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    interruptible: true,
    concurrencyPolicy: {
      blockedBy: [PER_TURN_KIND, PERIODIC_CLASSIFIER_KIND, 'chapter-close', 'translation-retry'],
    },
  })

  return {
    runs,
    nextHeld: () => {
      const run = ready.shift()
      return run ? Promise.resolve(run) : new Promise((resolve) => waiting.push(resolve))
    },
  }
}

async function advanceWatermark(ctx: PhaseContext): Promise<void> {
  const [tail] = await ctx.db
    .select({ position: storyEntries.position })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, ctx.branchId))
    .orderBy(desc(storyEntries.position))
    .limit(1)
  await ctx.db
    .update(branches)
    .set({ classifierStatus: { ...idleStatus(), processedThrough: tail?.position ?? 0 } })
    .where(eq(branches.id, ctx.branchId))
}

/** A gate-holding run with no pipeline behind it, for refusal tests; only `abortRun` ends it. */
export function registerStoreOnlyRun(kind: string, branchId: string): RunState {
  const run: RunState = {
    runId: `run_${kind}_${branchId}`,
    kind,
    gateBehavior: 'hard-gate',
    interruptible: false,
    beforeTurn: false,
    actionId: `act_${kind}_${branchId}`,
    storyId: 's1',
    branchId,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
  generationStore.startRun(run)
  return run
}

export function recordDeferrals(): RunDeferredEvent[] {
  const events: RunDeferredEvent[] = []
  pipelineEventBus.subscribe('run_deferred', (event) => events.push(event))
  return events
}

export function runningPass(branchId: string): RunState | undefined {
  return [...generationStore.getTxState().runs.values()].find(
    (r) => r.kind === PERIODIC_CLASSIFIER_KIND && r.branchId === branchId,
  )
}
