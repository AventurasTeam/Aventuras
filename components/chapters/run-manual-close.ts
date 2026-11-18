import {
  describeCloseFailure,
  retryRefusalText,
  toCloseFailureMeta,
} from '@/components/reader/system-entry-actions'
import { raiseSystemEntry, startManualClose } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

/** Starts the close the modal confirmed; speaks only for a refusal or a failed pre-flight. */
export async function runManualClose(branchId: string, endEntryId: string): Promise<void> {
  try {
    const result = await startManualClose(branchId, endEntryId, ctx)
    if (result.outcome === 'rejected') {
      logger.warn('app.manual_close_refused', { branchId, endEntryId, blockedBy: result.blockedBy })
      toast.warning(retryRefusalText(result.blockedBy, 'reader:systemEntry.closeRetryBlocked'))
      return
    }
    if (result.outcome !== 'preflight-failed') return
    const { error } = result
    const { failure, target, phaseName } = error
    logger.warn('app.manual_close_preflight_failed', {
      branchId,
      endEntryId,
      failure,
      target,
      phaseName,
    })
    await raiseSystemEntry(
      {
        branchId,
        content: describeCloseFailure(error).content,
        // The entry keeps the pick, so its Retry pre-flights the same pick again.
        failure: { ...toCloseFailureMeta(error, undefined), closePick: endEntryId },
      },
      ctx,
    )
    // The entry may be off screen (World, Plot), so the toast says where to look; a failed
    // pre-flight owes nothing, so it promises no rerun.
    toast.warning(t('chapters:closeModal.toast.preflightFailed'))
  } catch (error) {
    logger.error('app.manual_close_failed', {
      branchId,
      endEntryId,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.warning(t('chapters:closeModal.toast.startFailed'))
  }
}
