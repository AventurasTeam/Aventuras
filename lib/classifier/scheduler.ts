import type { ClassifierStatus } from '@/lib/db'

import { retryDelayForStatus, shouldCadenceFire } from './status'

// Mirrors the pipeline's StartRunResult by hand: importing it would cycle, since
// pipeline definitions import this module.
export type StartRunOutcome =
  | { outcome: 'completed' | 'aborted' | 'failed' }
  | { outcome: 'rejected'; blockedBy: string }

/** Declined without starting: a run for that branch is in flight, or the scheduler is stopped. */
export type RunNowOutcome = StartRunOutcome | { outcome: 'busy' | 'stopped' }

export type ClassifierSchedulerDeps = {
  cadenceFor: (branchId: string) => number
  unprocessedTurnsFor: (branchId: string, processedThrough: number | null) => Promise<number>
  statusFor: (branchId: string) => Promise<ClassifierStatus>
  startRun: (branchId: string) => Promise<StartRunOutcome>
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

type BranchState = { inFlight: boolean; timer: unknown }

export function createClassifierScheduler(deps: ClassifierSchedulerDeps) {
  let stopped = false
  // Keyed per branch: state is per-branch even though only one story is open
  // at a time, because the boot wiring passes the current branch id per
  // event, so a retry pending for branch A must survive a tick for branch B.
  const branches = new Map<string, BranchState>()

  function stateFor(branchId: string): BranchState {
    let state = branches.get(branchId)
    if (!state) {
      state = { inFlight: false, timer: null }
      branches.set(branchId, state)
    }
    return state
  }

  function clearPending(branchId: string): void {
    const state = stateFor(branchId)
    if (state.timer != null) deps.clearTimer(state.timer)
    state.timer = null
  }

  async function start(branchId: string): Promise<StartRunOutcome | undefined> {
    const state = stateFor(branchId)
    if (stopped || state.inFlight) return undefined
    state.inFlight = true
    clearPending(branchId)
    try {
      const result = await deps.startRun(branchId)
      // Best-effort by canon: a rejected start waits for the next tick rather
      // than queueing, so a chapter-close never accumulates a retry backlog.
      // An aborted run was deliberately cancelled, so it takes the same
      // no-retry path as completed — retrying would fight the canceller.
      // A 'rejected' retry (the branch was closed since the timer armed) drops the
      // timer too; the persisted 'retrying' state re-fires it on the next cadence
      // tick, so re-arming here would only spin against a branch nobody reopened.
      if (result.outcome !== 'failed') return result
      // The phase already persisted the failure through nextStatusOnFailure, so
      // re-read rather than re-deriving: retryDelayForStatus owns the mapping
      // from attempt count to delay, in one place.
      const delay = retryDelayForStatus(await deps.statusFor(branchId))
      if (delay == null || stopped) return result
      state.timer = deps.setTimer(() => void start(branchId), delay)
      return result
    } finally {
      state.inFlight = false
    }
  }

  return {
    /** Cadence tick: a turn landed, so the unprocessed count changed. */
    noteTurnCommitted: async (branchId: string): Promise<void> => {
      if (stopped || stateFor(branchId).inFlight) return
      const status = await deps.statusFor(branchId)
      const unprocessedTurns = await deps.unprocessedTurnsFor(branchId, status.processedThrough)
      if (!shouldCadenceFire({ status, unprocessedTurns, cadence: deps.cadenceFor(branchId) }))
        return
      await start(branchId)
    },
    /** `[Run classifier now]` — bypasses the count and the suspension. */
    runNow: async (branchId: string): Promise<RunNowOutcome> => {
      if (stopped) return { outcome: 'stopped' }
      if (stateFor(branchId).inFlight) return { outcome: 'busy' }
      clearPending(branchId)
      const result = await start(branchId)
      return result ?? { outcome: 'busy' }
    },
    stop: (): void => {
      stopped = true
      for (const branchId of branches.keys()) clearPending(branchId)
    },
  }
}
