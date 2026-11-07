import { closeOwed, type ChainEnd, type RejectedStart } from '@/lib/pipeline'
import { currentStoryStore } from '@/lib/stores'

import { MANUAL_CLOSE_REFUSAL, startCloseChain } from './close-chain'
import type { DbCtx } from '../types'

/** What a close entry's Retry ran: nothing, since no close is owed any more; a refusal; the end. */
export type OwedCloseRun =
  | { outcome: 'nothing-owed' }
  | RejectedStart
  | { outcome: 'ran'; end: ChainEnd }

/**
 * A close-failure entry's Retry (reader-composer.md → During a memory update): the catch-up pass
 * while entries are unprocessed, which chains the close, else the close. Resolves once the chain
 * ends; rejects when the origin throws. The owed check comes first: `startCloseChain` starts a
 * pass over any backlog.
 */
export async function runOwedClose(branchId: string, ctx: DbCtx): Promise<OwedCloseRun> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId)
    return { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.branchNotOpen }
  if (!(await closeOwed(branchId, open, ctx))) return { outcome: 'nothing-owed' }
  const started = await startCloseChain(branchId, ctx)
  return 'outcome' in started ? started : { outcome: 'ran', end: started }
}
