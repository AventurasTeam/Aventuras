import type { PreflightFailedStart, RejectedStart, TxResult } from '@/lib/pipeline'

import { startPickedCloseChain } from './picked-close'
import type { DbCtx } from '../types'

export { MANUAL_CLOSE_REFUSAL, type ManualCloseRefusal } from './close-chain'

/**
 * chapter-close.md → Manual user-triggered close, ending on `endEntryId`. C14: a pass first while
 * entries are unprocessed; the pick is written as the first run reserves; resolves with the
 * chain's last run. The close's pre-flight runs before anything starts, a pass included.
 */
export async function startManualClose(
  branchId: string,
  endEntryId: string,
  ctx: DbCtx,
): Promise<TxResult | RejectedStart | PreflightFailedStart> {
  const end = await startPickedCloseChain(branchId, endEntryId, ctx)
  return 'outcome' in end ? end : end.result
}
