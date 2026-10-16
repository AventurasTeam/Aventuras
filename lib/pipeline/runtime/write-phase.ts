import { generationStore, type TxState } from '@/lib/stores'

import { PER_TURN_KIND } from '../definitions/per-turn'
import type { PhaseContext } from '../types'
import { holdWritePhase, releaseWritePhase } from './action-port'

// Pending first: a turn is marked from its admission until its run is in txState.
function turnInFlight(txState: TxState, branchId: string): boolean {
  for (const turn of txState.pendingTurns) if (turn.branchId === branchId) return true
  for (const run of txState.runs.values())
    if (run.branchId === branchId && run.kind === PER_TURN_KIND) return true
  return false
}

function nextChangeOrAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      unsubscribe()
      signal.removeEventListener('abort', done)
      resolve()
    }
    const unsubscribe = generationStore.subscribe(done)
    signal.addEventListener('abort', done, { once: true })
  })
}

function grantedBeforeAbort(grant: Promise<void>, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const aborted = () => resolve(false)
    signal.addEventListener('abort', aborted, { once: true })
    void grant.then(() => {
      signal.removeEventListener('abort', aborted)
      resolve(true)
    })
  })
}

/**
 * generation-pipeline.md → No-gate write phase: waits until no `per-turn` run is in flight on the
 * branch, then takes the branch write lock exclusive. True once it holds; false on an abort, with
 * nothing held or queued. The check and the request share one tick, so a turn admitted after
 * the check queues its first write behind this hold and cannot register until the run settles.
 */
export async function enterWritePhase(
  ctx: Pick<PhaseContext, 'branchId' | 'actionId' | 'abortSignal'>,
): Promise<boolean> {
  const { branchId, actionId, abortSignal: signal } = ctx
  for (;;) {
    if (signal.aborted) return false
    if (!turnInFlight(generationStore.getTxState(), branchId)) break
    await nextChangeOrAbort(signal)
  }
  if (await grantedBeforeAbort(holdWritePhase(branchId, actionId), signal)) return true
  // The lock prefers writers: a request left queued would hold every write back until abortRun.
  releaseWritePhase(branchId, actionId)
  return false
}
