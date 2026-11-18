import {
  CLASSIFIER_HELD,
  closeOwed,
  isClassifierHeld,
  type ChainEnd,
  type PreflightFailedStart,
  type RejectedStart,
} from '@/lib/pipeline'
import { currentStoryStore, generationStore } from '@/lib/stores'

import { MANUAL_CLOSE_REFUSAL, refused, startCloseChain } from './close-chain'
import type { DbCtx } from '../types'

/**
 * What a close entry's Retry ran: nothing, since no close is owed any more; a refusal; a failed
 * click's pick refused again by its pre-flight (`runPickedClose`); the end.
 */
export type OwedCloseRun =
  | { outcome: 'nothing-owed' }
  | RejectedStart
  | PreflightFailedStart
  | { outcome: 'ran'; end: ChainEnd }

/**
 * A close-failure entry's Retry (reader-composer.md → During a memory update): the catch-up pass
 * (chains the close) while entries are unprocessed, else the close. Rejects when the origin throws.
 * The owed check precedes `startCloseChain`, which starts a pass over any backlog.
 */
export async function runOwedClose(branchId: string, ctx: DbCtx): Promise<OwedCloseRun> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return refused(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  // A held branch fails the next Send as held, so it can't settle as nothing owed.
  if (await isClassifierHeld(branchId, ctx)) return refused(CLASSIFIER_HELD)
  if (!(await closeOwed(open, ctx))) {
    // No close is owed any more, and its deferral would hold back the cadence pass.
    generationStore.clearDeferredClose(branchId)
    return { outcome: 'nothing-owed' }
  }
  const started = await startCloseChain(branchId, ctx)
  if (!('outcome' in started)) return { outcome: 'ran', end: started }
  // Given no pre-flight, the start can't report one; the close's own pre-flight speaks as its run.
  if (started.outcome === 'preflight-failed')
    throw new Error('runOwedClose: a start given no pre-flight reported a failed one')
  return started
}
