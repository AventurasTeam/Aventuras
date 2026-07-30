import type { ClassifierStatus } from '@/lib/db'

import { retryDelayForStatus, shouldCadenceFire } from './status'

export type StartRunOutcome =
  | { outcome: 'completed' | 'aborted' | 'failed' }
  | { outcome: 'rejected'; blockedBy: string }

export type ClassifierSchedulerDeps = {
  cadenceFor: (branchId: string) => number
  headPositionFor: (branchId: string) => Promise<number>
  statusFor: (branchId: string) => Promise<ClassifierStatus>
  startRun: (branchId: string) => Promise<StartRunOutcome>
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export function createClassifierScheduler(deps: ClassifierSchedulerDeps) {
  let inFlight = false
  let stopped = false
  let timer: unknown = null

  function clearPending(): void {
    if (timer != null) deps.clearTimer(timer)
    timer = null
  }

  async function start(branchId: string): Promise<void> {
    if (stopped || inFlight) return
    inFlight = true
    clearPending()
    try {
      const result = await deps.startRun(branchId)
      // Best-effort by canon: a rejected start waits for the next tick rather
      // than queueing, so a chapter-close never accumulates a retry backlog.
      if (result.outcome !== 'failed') return
      // The phase already persisted the failure through nextStatusOnFailure, so
      // re-read rather than re-deriving: retryDelayForStatus owns the mapping
      // from attempt count to delay, in one place.
      const delay = retryDelayForStatus(await deps.statusFor(branchId))
      if (delay == null || stopped) return
      timer = deps.setTimer(() => void start(branchId), delay)
    } finally {
      inFlight = false
    }
  }

  return {
    /** Cadence tick: a turn landed, so the unprocessed count changed. */
    noteTurnCommitted: async (branchId: string): Promise<void> => {
      if (stopped || inFlight) return
      const [status, headPosition] = await Promise.all([
        deps.statusFor(branchId),
        deps.headPositionFor(branchId),
      ])
      if (!shouldCadenceFire({ status, headPosition, cadence: deps.cadenceFor(branchId) })) return
      await start(branchId)
    },
    /** `[Run classifier now]` — bypasses the count and the suspension. */
    runNow: async (branchId: string): Promise<void> => {
      clearPending()
      await start(branchId)
    },
    stop: (): void => {
      stopped = true
      clearPending()
    },
  }
}
