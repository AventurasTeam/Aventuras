import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'

export type RunState = {
  runId: string
  kind: string
  gateBehavior: 'hard-gate' | 'no-gate'
  /** Copied from the pipeline at reserve: a head reversal or Cancel ends this run and defers it. */
  interruptible: boolean
  /**
   * Started by Send to run deferred work before the turn
   * (generation-pipeline.md → chainsTo on predecessor).
   */
  beforeTurn: boolean
  actionId: string
  storyId: string | null
  branchId: string
  abortController: AbortController
  currentPhase: string
  // Caller-supplied run parameters (RunCtx.inputs), read-only for phases.
  inputs?: unknown
  intermediates: Record<string, unknown>
  lastResult?: { status: 'completed' | 'aborted' | 'failed' }
  // Resolves when the run reaches commit or abort. Lets a context that did not
  // start the run (chapter-close drain, prose-reversal cancel, a yieldsTo abort)
  // await its terminal without holding the runPipeline promise.
  terminal: Promise<void>
  resolveTerminal: () => void
}

/** A turn admitted on its branch but not yet registered as a run; identity is the token. */
export type PendingTurn = { readonly branchId: string }

export type DeferredWork = { readonly pass?: true; readonly close?: true }
export type DeferredWorkKind = keyof DeferredWork

// reversalInProgress brackets a prose-reversal's wait->sweep window, blocking REVERSAL_BLOCKED
// scheduling (concurrency.ts) and user dispatch. pendingTurns: generation-pipeline.md → No-gate
// write phase. ReadonlyMap keeps consumers off the mutators; intermediates stays mutable.
export type TxState = {
  runs: ReadonlyMap<string, RunState>
  reversalInProgress: boolean
  pendingTurns: ReadonlySet<PendingTurn>
  /** Interrupted runs, run before that branch's next turn; in memory only. */
  deferred: ReadonlyMap<string, DeferredWork>
}

// A pending turn counts: it is about to raise the hard gate, and a reversal opened in the gap
// would have its queued user_action refused.
export function isUserEditBlocked(txState: TxState): boolean {
  if (txState.reversalInProgress || txState.pendingTurns.size > 0) return true
  return [...txState.runs.values()].some((r) => r.gateBehavior === 'hard-gate')
}

// generation-pipeline.md → Gate derivation as a selector: the gate a pass or a close holds on
// this branch is the one a head reversal passes through by interrupting it.
export function isHeadReversalBlocked(txState: TxState, branchId: string): boolean {
  if (txState.reversalInProgress || txState.pendingTurns.size > 0) return true
  return [...txState.runs.values()].some(
    (r) => r.gateBehavior === 'hard-gate' && !(r.interruptible && r.branchId === branchId),
  )
}

// A turn pending on the branch and a reversal hold no run yet (a regenerate's mark spans its
// sweep), so leaving the story must wait for them too.
export function isStoryBusy(txState: TxState, storyId: string, branchId: string): boolean {
  if (txState.reversalInProgress) return true
  for (const turn of txState.pendingTurns) if (turn.branchId === branchId) return true
  return [...txState.runs.values()].some((r) => r.storyId === storyId)
}

const DEFERRED_WORK_KIND: ReadonlyMap<string, DeferredWorkKind> = new Map([
  [PERIODIC_CLASSIFIER_KIND, 'pass'],
  ['chapter-close', 'close'],
])

export function deferredWorkKindOf(kind: string): DeferredWorkKind | null {
  return DEFERRED_WORK_KIND.get(kind) ?? null
}

function deferralKeyOf(run: RunState | undefined): DeferredWorkKind | null {
  return run?.interruptible ? deferredWorkKindOf(run.kind) : null
}

// An emptied record is deleted, not left as {}: readers test `deferred.has(branchId)`.
function withDeferral(
  deferred: ReadonlyMap<string, DeferredWork>,
  branchId: string,
  key: DeferredWorkKind,
  on: boolean,
): ReadonlyMap<string, DeferredWork> {
  const prev = deferred.get(branchId)
  if ((prev?.[key] === true) === on) return deferred
  const pass = key === 'pass' ? on : prev?.pass === true
  const close = key === 'close' ? on : prev?.close === true
  const next = new Map(deferred)
  if (pass && close) next.set(branchId, { pass: true, close: true })
  else if (pass) next.set(branchId, { pass: true })
  else if (close) next.set(branchId, { close: true })
  else next.delete(branchId)
  return next
}

type GenerationState = {
  txState: TxState
  // Turns from admission until their body settles, past the pending mark (which ends at
  // reservation): a regenerate's follow-up sweep runs in this tail with no run and no mark.
  turnBodies: ReadonlySet<PendingTurn>
  // Monotonic; bumps when a run leaves txState (finish, successor swap, abort)
  // or a reversal settles — the points where a run's writes are final.
  settleCount: number
  startRun: (run: RunState) => void
  setCurrentPhase: (runId: string, phase: string) => void
  recordPhaseResult: (
    runId: string,
    phase: string,
    result: { status: 'completed' | 'aborted' | 'failed' },
  ) => void
  /** Removes the run and swaps in `successor` atomically; a pass or close clears its deferral. */
  finishRun: (runId: string, successor?: RunState) => void
  /**
   * Removes the run. For an interruptible pass or close, `'aborted'` records it deferred on its
   * branch and `'failed'` clears that record; no outcome leaves the record alone. Returns true
   * only when this call newly recorded the deferral.
   */
  abortRun: (runId: string, outcome?: 'aborted' | 'failed') => boolean
  setReversalInProgress: (value: boolean) => void
  /** Marks a turn pending on `branchId` until `body` settles; `body` may end the mark sooner. */
  bracketPendingTurn: <T>(
    branchId: string,
    body: (endEarly: () => void) => Promise<T>,
  ) => Promise<T>
  __reset: () => void
}

const emptyTxState = (): TxState => ({
  runs: new Map(),
  reversalInProgress: false,
  pendingTurns: new Set(),
  deferred: new Map(),
})

const store = createStore<GenerationState>()((set) => ({
  txState: emptyTxState(),
  turnBodies: new Set(),
  settleCount: 0,
  startRun: (run) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      runs.set(run.runId, run)
      return { txState: { ...s.txState, runs } }
    }),
  setCurrentPhase: (runId, phase) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      const r = runs.get(runId)
      if (r) runs.set(runId, { ...r, currentPhase: phase })
      return { txState: { ...s.txState, runs } }
    }),
  recordPhaseResult: (runId, _phase, result) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      const r = runs.get(runId)
      if (r) runs.set(runId, { ...r, lastResult: result })
      return { txState: { ...s.txState, runs } }
    }),
  finishRun: (runId, successor) =>
    set((s) => {
      const run = s.txState.runs.get(runId)
      const runs = new Map(s.txState.runs)
      runs.delete(runId)
      if (successor) runs.set(successor.runId, successor)
      const key = deferralKeyOf(run)
      const deferred =
        run && key ? withDeferral(s.txState.deferred, run.branchId, key, false) : s.txState.deferred
      return { txState: { ...s.txState, runs, deferred }, settleCount: s.settleCount + 1 }
    }),
  abortRun: (runId, outcome) => {
    let recorded = false
    set((s) => {
      const run = s.txState.runs.get(runId)
      const runs = new Map(s.txState.runs)
      runs.delete(runId)
      const key = deferralKeyOf(run)
      let deferred = s.txState.deferred
      if (run && key && outcome) {
        recorded = outcome === 'aborted' && deferred.get(run.branchId)?.[key] !== true
        deferred = withDeferral(deferred, run.branchId, key, outcome === 'aborted')
      }
      return { txState: { ...s.txState, runs, deferred }, settleCount: s.settleCount + 1 }
    })
    return recorded
  },
  setReversalInProgress: (value) =>
    set((s) => ({
      txState: { ...s.txState, reversalInProgress: value },
      settleCount: !value && s.txState.reversalInProgress ? s.settleCount + 1 : s.settleCount,
    })),
  bracketPendingTurn: async (branchId, body) => {
    const turn: PendingTurn = { branchId }
    set((s) => ({
      txState: { ...s.txState, pendingTurns: new Set([...s.txState.pendingTurns, turn]) },
      turnBodies: new Set([...s.turnBodies, turn]),
    }))
    // Idempotent; a no-op once __reset dropped the token, so a late end can't free another's.
    const end = () =>
      set((s) => {
        if (!s.txState.pendingTurns.has(turn)) return s
        const pendingTurns = new Set(s.txState.pendingTurns)
        pendingTurns.delete(turn)
        return { txState: { ...s.txState, pendingTurns } }
      })
    try {
      return await body(end)
    } finally {
      set((s) => {
        if (!s.turnBodies.has(turn)) return s
        const turnBodies = new Set(s.turnBodies)
        turnBodies.delete(turn)
        if (!s.txState.pendingTurns.has(turn)) return { turnBodies }
        const pendingTurns = new Set(s.txState.pendingTurns)
        pendingTurns.delete(turn)
        return { txState: { ...s.txState, pendingTurns }, turnBodies }
      })
    }
  },
  __reset: () => set({ txState: emptyTxState(), turnBodies: new Set(), settleCount: 0 }),
}))

function getTxState(): TxState {
  return store.getState().txState
}

function turnBodyActive(branchId: string): boolean {
  for (const turn of store.getState().turnBodies) if (turn.branchId === branchId) return true
  return false
}

function getSettleCount(): number {
  return store.getState().settleCount
}

// Selectors must return a value that is stable under Object.is while the state
// they read is unchanged: zustand v5 hands the selector straight to
// useSyncExternalStore with no equality function, so a freshly allocated object
// or array re-renders without end. Derive primitives here, shape them in the
// component.
function useGeneration<T>(selector: (s: { txState: TxState; settleCount: number }) => T): T {
  return useStore(store, selector as (s: GenerationState) => T)
}

const api = store.getState()

export const generationStore = {
  useGeneration,
  getTxState,
  getSettleCount,
  isUserEditBlocked: () => isUserEditBlocked(getTxState()),
  isHeadReversalBlocked: (branchId: string) => isHeadReversalBlocked(getTxState(), branchId),
  hasActiveRun: () => getTxState().runs.size > 0,
  startRun: api.startRun,
  setCurrentPhase: api.setCurrentPhase,
  recordPhaseResult: api.recordPhaseResult,
  finishRun: api.finishRun,
  abortRun: api.abortRun,
  setReversalInProgress: api.setReversalInProgress,
  bracketPendingTurn: api.bracketPendingTurn,
  /** Fires after every state change; returns the unsubscribe. */
  subscribe: (listener: () => void): (() => void) => store.subscribe(() => listener()),
  __reset: api.__reset,
}

// Denylist, not an allowlist: an unlisted kind reads as foreground, so a pipeline
// added later shows the pill instead of running invisibly.
const BACKGROUND_KINDS: readonly string[] = [PERIODIC_CLASSIFIER_KIND]

/** Exported so a caller narrowing further (the pill splits foreground by phase)
 * composes with the denylist instead of re-hardcoding it. */
export function isBackgroundKind(kind: string): boolean {
  return BACKGROUND_KINDS.includes(kind)
}

export function isForegroundGenerating(txState: TxState, branchId: string): boolean {
  return [...txState.runs.values()].some(
    (r) => r.branchId === branchId && !isBackgroundKind(r.kind),
  )
}

export function backgroundClassifierRunning(txState: TxState, branchId: string): boolean {
  return [...txState.runs.values()].some(
    (r) => r.branchId === branchId && r.kind === PERIODIC_CLASSIFIER_KIND,
  )
}

// Generic wait on an in-flight run of `kind` on `branchId`; no-op when none is
// running. 'cancel' aborts then awaits terminal, 'finish' awaits the natural
// commit. Lives here so lib/actions can await a terminal without importing the
// orchestrator.
//
// branchId is required, not optional: matching on kind alone would let a
// reversal on one branch abort another branch's run and then sweep while that
// run is still writing. Only one story is open at a time today, but the
// classifier scheduler already keys its state per branch, so the two must agree.
export function awaitRunTerminal(
  kind: string,
  branchId: string,
  disposition: 'finish' | 'cancel',
): Promise<void> {
  const run = [...getTxState().runs.values()].find(
    (r) => r.kind === kind && r.branchId === branchId,
  )
  if (!run) return Promise.resolve()
  if (disposition === 'cancel') run.abortController.abort()
  return run.terminal
}

/** Aborts every interruptible run on the branch; resolves once each has ended. Records nothing. */
export async function interruptMemoryRuns(branchId: string): Promise<void> {
  const runs = [...getTxState().runs.values()].filter(
    (r) => r.interruptible && r.branchId === branchId,
  )
  for (const r of runs) r.abortController.abort()
  await Promise.all(runs.map((r) => r.terminal))
}

function nextStoreChange(): Promise<void> {
  return new Promise((resolve) => {
    const off = store.subscribe(() => {
      off()
      resolve()
    })
  })
}

/**
 * Aborts every run on the story until `isStoryBusy` is false and no turn body is active on the
 * branch: a turn ending during the wait can chain a pass, a pending turn or a reversal registers
 * its run later, and a regenerate's follow-up sweep starts after its run ended. Records nothing.
 */
export async function cancelStoryRuns(storyId: string, branchId: string): Promise<void> {
  for (;;) {
    const txState = getTxState()
    if (!isStoryBusy(txState, storyId, branchId) && !turnBodyActive(branchId)) return
    const runs = [...txState.runs.values()].filter((r) => r.storyId === storyId)
    if (runs.length === 0) {
      await nextStoreChange()
      continue
    }
    for (const r of runs) r.abortController.abort()
    await Promise.all(runs.map((r) => r.terminal))
    // A terminal can resolve before its run leaves txState; re-aborting would spin on it.
    if (runs.some((r) => getTxState().runs.has(r.runId))) await nextStoreChange()
  }
}
