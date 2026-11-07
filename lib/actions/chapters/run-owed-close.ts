import {
  CLASSIFIER_HELD,
  closeOwed,
  isClassifierHeld,
  type ChainEnd,
  type RejectedStart,
} from '@/lib/pipeline'
import { currentStoryStore, generationStore } from '@/lib/stores'

import { MANUAL_CLOSE_REFUSAL, startCloseChain } from './close-chain'
import type { DbCtx } from '../types'

/** What a close entry's Retry ran: nothing, since no close is owed any more; a refusal; the end. */
export type OwedCloseRun =
  | { outcome: 'nothing-owed' }
  | RejectedStart
  | { outcome: 'ran'; end: ChainEnd }

/**
 * A close-failure entry's Retry (reader-composer.md → During a memory update): the catch-up pass
 * (chains the close) while entries are unprocessed, else the close. Rejects when the origin throws.
 * The owed check precedes `startCloseChain`, which starts a pass over any backlog.
 */
export async function runOwedClose(branchId: string, ctx: DbCtx): Promise<OwedCloseRun> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId)
    return { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.branchNotOpen }
  // A held branch fails the next Send as held, so it can't settle as nothing owed.
  if (await isClassifierHeld(branchId, ctx))
    return { outcome: 'rejected', blockedBy: CLASSIFIER_HELD }
  if (!(await closeOwed(branchId, open, ctx))) {
    // A rollback below the threshold took back the cancelled close; its record would gate the cadence pass.
    generationStore.clearDeferredClose(branchId)
    return { outcome: 'nothing-owed' }
  }
  const started = await startCloseChain(branchId, ctx)
  return 'outcome' in started ? started : { outcome: 'ran', end: started }
}
