import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { CloseTask } from '@/lib/db'

import { currentStoryStore } from '../current-story/current-story'

export type DeferredWork = { readonly pass?: true; readonly close?: true }
export type DeferredWorkKind = keyof DeferredWork

/** A run's slot: the deferral it records, or `rerun`, a close's re-run, which records none. */
export type RunSlot = DeferredWorkKind | 'rerun'

/** C6: the agent task a close last started; `index` from 1, `part` as C4's (0 chapter-wide). */
export type CloseProgress = Readonly<{
  task: CloseTask
  part: number
  index: number
  total: number
}>

export type RunState = {
  runId: string
  kind: string
  gateBehavior: 'hard-gate' | 'no-gate'
  /** From the pipeline at reserve (`runSlot`, else `interruptible`): the slot a head reversal or
   * Cancel defers this run in (`rerun` defers none); null if never deferred. */
  interruptible: RunSlot | null
  /** Owed work before a Send's turn, every run of its chain (classifier.md → Failure policy). */
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
  /** C6: set as each agent task starts and kept to the run's end. */
  closeProgress?: CloseProgress
  // Resolves at commit or abort: lets a context that didn't start the run (interrupt, Cancel &
  // leave, yieldsTo abort) await its end without the runPipeline promise.
  terminal: Promise<void>
  resolveTerminal: () => void
}

/** A turn admitted on its branch but not yet registered as a run; identity is the token. */
export type PendingTurn = { readonly branchId: string }

/** A bracket body's own mark, which `isStoryBusy` can skip, and the idempotent end releasing it. */
export type PendingMark = { readonly mark: PendingTurn; readonly end: () => void }

/** A manual close's pick (C14). A close owed by the threshold keeps no record. */
export type PendingClose = { readonly endEntryId: string }

/** A close's re-run, held for its chain's life (generation-pipeline.md → Multi-run txState). */
export type PendingRerun = { readonly chapterId: string }

/** A branch whose re-run's abort couldn't take itself back: held until a restart's boot recovery,
 * or until a delete of the branch or its story. */
export type HeldBranch = { readonly storyId: string | null }

/** RejectedStart.blockedBy for a start on a held branch, and the gate kind its controls name. */
export const RERUN_HELD = 'rerun-held'

// reversalInProgress: a prose reversal's interrupt->sweep window; blocks interruptible starts and
// user dispatch. pendingTurns: generation-pipeline.md → Gate derivation as a selector.
// ReadonlyMap keeps consumers off the mutators; intermediates stays mutable.
export type TxState = {
  runs: ReadonlyMap<string, RunState>
  reversalInProgress: boolean
  pendingTurns: ReadonlySet<PendingTurn>
  /** Interrupted runs, run before that branch's next turn; in memory only. */
  deferred: ReadonlyMap<string, DeferredWork>
  /** In memory only. */
  pendingClose: ReadonlyMap<string, PendingClose>
  /** In memory only; cleared in the update that ends the re-run's chain, or by a delete of its
   * branch or its story. */
  pendingRerun: ReadonlyMap<string, PendingRerun>
  /** In memory only, so a restart drops it; else only its branch's or story's delete clears it. */
  heldBranches: ReadonlyMap<string, HeldBranch>
}

export function isBranchHeld(txState: TxState, branchId: string): boolean {
  return txState.heldBranches.has(branchId)
}

// A pending turn counts: it is about to raise the hard gate, and a reversal opened in the gap
// would have its queued user_action refused. `branchId` adds that branch's hold.
export function isUserEditBlocked(txState: TxState, branchId?: string | null): boolean {
  if (txState.reversalInProgress || txState.pendingTurns.size > 0) return true
  if (branchId != null && isBranchHeld(txState, branchId)) return true
  return [...txState.runs.values()].some((r) => r.gateBehavior === 'hard-gate')
}

// generation-pipeline.md → Gate derivation as a selector: the gate a pass or a close holds on
// this branch is the one a head reversal passes through by interrupting it.
export function isHeadReversalBlocked(txState: TxState, branchId: string): boolean {
  if (txState.reversalInProgress || txState.pendingTurns.size > 0) return true
  if (isBranchHeld(txState, branchId)) return true
  return [...txState.runs.values()].some((r) => runBlocksHeadReversal(r, branchId))
}

/** Whether this run is one a head reversal on `branchId` can't pass through by interrupting it. */
export function runBlocksHeadReversal(run: RunState, branchId: string): boolean {
  return run.gateBehavior === 'hard-gate' && !(run.interruptible && run.branchId === branchId)
}

// Pending turns and reversals hold no run yet, so leaving the story waits on them too; a start
// holding its own mark (`ownMark`) skips that one, never another on the branch. A held branch
// isn't busy: leaving waits on this, and a hold ends only with a restart or a delete of its
// branch or story.
export function isStoryBusy(
  txState: TxState,
  storyId: string,
  branchId: string,
  opts?: { ownMark?: PendingTurn },
): boolean {
  if (txState.reversalInProgress) return true
  for (const turn of txState.pendingTurns)
    if (turn.branchId === branchId && turn !== opts?.ownMark) return true
  return [...txState.runs.values()].some((r) => r.storyId === storyId)
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

// The same map when the branch has no entry, so a no-op write keeps the state object.
function withoutBranch<V>(map: ReadonlyMap<string, V>, branchId: string): ReadonlyMap<string, V> {
  if (!map.has(branchId)) return map
  const next = new Map(map)
  next.delete(branchId)
  return next
}

// A re-run records and clears no deferral: the close it replaces stands.
function deferralSlotOf(run: RunState | undefined): DeferredWorkKind | null {
  const slot = run?.interruptible
  return slot && slot !== 'rerun' ? slot : null
}

type GenerationState = {
  txState: TxState
  // Each bracketPendingTurn body, from its mark until it settles, past the mark's end at
  // reservation: a regenerate's follow-up sweep runs in this tail with no run and no mark.
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
  /** Removes the run, swapping in `successor` atomically; clears its deferral, a close's pending
   * close, and, for a pass or close with no successor, the pending re-run. */
  finishRun: (runId: string, successor?: RunState) => void
  /**
   * Removes the run. `'aborted'` defers an interruptible pass or close; `'failed'`/`'unwound'`
   * leave the record (only a commit clears it); a re-run records none. A pending close stays; any
   * pass or close end clears the pending re-run. A re-run `unreversed` (its abort's reversal didn't
   * commit) holds its branch. Returns the slot newly recorded, or null.
   */
  abortRun: (
    runId: string,
    outcome: 'aborted' | 'failed' | 'unwound',
    opts?: { unreversed?: true },
  ) => DeferredWorkKind | null
  /** Writes the branch's owed close, replacing any. */
  setPendingClose: (branchId: string, record: PendingClose) => void
  clearPendingClose: (branchId: string) => void
  /** Writes the branch's re-run, replacing any. */
  setPendingRerun: (branchId: string, record: PendingRerun) => void
  clearPendingRerun: (branchId: string) => void
  /** Removes only `deferred.close`; a deferred pass stays. */
  clearDeferredClose: (branchId: string) => void
  /** Drops all four records in one update, so no subscriber sees some without the others. */
  dropBranchRecords: (branchId: string) => void
  /** C6: replaces the stored run with a copy carrying `progress`; no-op for an unknown run. */
  setCloseProgress: (runId: string, progress: CloseProgress) => void
  setReversalInProgress: (value: boolean) => void
  /**
   * Marks a turn pending on `branchId` until `body` settles; `body` may end the mark sooner.
   * `own.end` is `endEarly`.
   */
  bracketPendingTurn: <T>(
    branchId: string,
    body: (endEarly: () => void, own: PendingMark) => Promise<T>,
  ) => Promise<T>
  __reset: () => void
}

const emptyTxState = (): TxState => ({
  runs: new Map(),
  reversalInProgress: false,
  pendingTurns: new Set(),
  deferred: new Map(),
  pendingClose: new Map(),
  pendingRerun: new Map(),
  heldBranches: new Map(),
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
      const slot = deferralSlotOf(run)
      const deferred =
        run && slot
          ? withDeferral(s.txState.deferred, run.branchId, slot, false)
          : s.txState.deferred
      const pendingClose =
        run?.interruptible === 'close'
          ? withoutBranch(s.txState.pendingClose, run.branchId)
          : s.txState.pendingClose
      const pendingRerun =
        run?.interruptible && !successor
          ? withoutBranch(s.txState.pendingRerun, run.branchId)
          : s.txState.pendingRerun
      return {
        txState: { ...s.txState, runs, deferred, pendingClose, pendingRerun },
        settleCount: s.settleCount + 1,
      }
    }),
  abortRun: (runId, outcome, opts) => {
    let recorded: DeferredWorkKind | null = null
    set((s) => {
      const run = s.txState.runs.get(runId)
      const runs = new Map(s.txState.runs)
      runs.delete(runId)
      const key = deferralSlotOf(run)
      let deferred = s.txState.deferred
      if (run && key && outcome === 'aborted') {
        if (deferred.get(run.branchId)?.[key] !== true) recorded = key
        deferred = withDeferral(deferred, run.branchId, key, true)
      }
      const pendingRerun = run?.interruptible
        ? withoutBranch(s.txState.pendingRerun, run.branchId)
        : s.txState.pendingRerun
      const heldBranches =
        run?.interruptible === 'rerun' && opts?.unreversed
          ? new Map([...s.txState.heldBranches, [run.branchId, { storyId: run.storyId }]])
          : s.txState.heldBranches
      return {
        txState: { ...s.txState, runs, deferred, pendingRerun, heldBranches },
        settleCount: s.settleCount + 1,
      }
    })
    return recorded
  },
  setPendingClose: (branchId, record) =>
    set((s) => {
      const pendingClose = new Map(s.txState.pendingClose)
      pendingClose.set(branchId, { endEntryId: record.endEntryId })
      return { txState: { ...s.txState, pendingClose } }
    }),
  clearPendingClose: (branchId) =>
    set((s) => {
      const pendingClose = withoutBranch(s.txState.pendingClose, branchId)
      return pendingClose === s.txState.pendingClose
        ? s
        : { txState: { ...s.txState, pendingClose } }
    }),
  setPendingRerun: (branchId, record) =>
    set((s) => {
      const pendingRerun = new Map(s.txState.pendingRerun)
      pendingRerun.set(branchId, { chapterId: record.chapterId })
      return { txState: { ...s.txState, pendingRerun } }
    }),
  clearPendingRerun: (branchId) =>
    set((s) => {
      const pendingRerun = withoutBranch(s.txState.pendingRerun, branchId)
      return pendingRerun === s.txState.pendingRerun
        ? s
        : { txState: { ...s.txState, pendingRerun } }
    }),
  clearDeferredClose: (branchId) =>
    set((s) => {
      const deferred = withDeferral(s.txState.deferred, branchId, 'close', false)
      return deferred === s.txState.deferred ? s : { txState: { ...s.txState, deferred } }
    }),
  dropBranchRecords: (branchId) =>
    set((s) => {
      const deferred = withoutBranch(s.txState.deferred, branchId)
      const pendingClose = withoutBranch(s.txState.pendingClose, branchId)
      const pendingRerun = withoutBranch(s.txState.pendingRerun, branchId)
      const heldBranches = withoutBranch(s.txState.heldBranches, branchId)
      if (
        deferred === s.txState.deferred &&
        pendingClose === s.txState.pendingClose &&
        pendingRerun === s.txState.pendingRerun &&
        heldBranches === s.txState.heldBranches
      )
        return s
      return { txState: { ...s.txState, deferred, pendingClose, pendingRerun, heldBranches } }
    }),
  setCloseProgress: (runId, progress) =>
    set((s) => {
      const run = s.txState.runs.get(runId)
      if (!run) return s
      const runs = new Map(s.txState.runs)
      runs.set(runId, { ...run, closeProgress: progress })
      return { txState: { ...s.txState, runs } }
    }),
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
      return await body(end, { mark: turn, end })
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
  /** The open story's branch counts its hold: every user write targets the open story. */
  isUserEditBlocked: () =>
    isUserEditBlocked(getTxState(), currentStoryStore.getCurrentStory()?.branchId),
  isHeadReversalBlocked: (branchId: string) => isHeadReversalBlocked(getTxState(), branchId),
  hasActiveRun: () => getTxState().runs.size > 0,
  /** From a turn's pending mark until its body settles, past an early end of the mark. */
  isTurnBodyActive: turnBodyActive,
  startRun: api.startRun,
  setCurrentPhase: api.setCurrentPhase,
  recordPhaseResult: api.recordPhaseResult,
  finishRun: api.finishRun,
  abortRun: api.abortRun,
  setPendingClose: api.setPendingClose,
  clearPendingClose: api.clearPendingClose,
  setPendingRerun: api.setPendingRerun,
  clearPendingRerun: api.clearPendingRerun,
  clearDeferredClose: api.clearDeferredClose,
  dropBranchRecords: api.dropBranchRecords,
  setCloseProgress: api.setCloseProgress,
  setReversalInProgress: api.setReversalInProgress,
  bracketPendingTurn: api.bracketPendingTurn,
  /** Fires after every state change; returns the unsubscribe. */
  subscribe: (listener: () => void): (() => void) => store.subscribe(() => listener()),
  __reset: api.__reset,
}

/**
 * The pass or close in flight on a branch, or anywhere in a story. Returns the stored run,
 * so it is stable under Object.is and safe as a `useGeneration` selector.
 */
export function selectMemoryRun(
  txState: TxState,
  scope: { branchId: string; storyId?: never } | { storyId: string; branchId?: never },
): RunState | undefined {
  for (const run of txState.runs.values()) {
    if (!run.interruptible) continue
    if (scope.branchId != null ? run.branchId === scope.branchId : run.storyId === scope.storyId)
      return run
  }
  return undefined
}

// Waits on an in-flight run of `kind` on `branchId` (no-op if none): 'cancel' aborts it first,
// 'finish' awaits the natural commit. Lives here so callers needn't import the orchestrator.
// branchId is required: kind alone would let a caller on one branch abort another's run.
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

/** Aborts the branch's interruptible runs and awaits their end; each records its own deferral. */
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
 * Aborts every run on the story until `isStoryBusy` is false and no turn body runs on the branch:
 * a chained pass, pending turn, reversal or regenerate sweep registers late. Records nothing
 * itself; each aborted pass or close records its own deferral.
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
