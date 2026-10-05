import { useCallback } from 'react'

import type { EditResult } from '@/components/reader/reader-document-types'
import { updateStoryEntryContent, type DbCtx } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

/**
 * Host half of the in-place prose edit; the host owns the toast and the draft stays open on
 * failure. Failure rides the result channel, as in world-time-editing.ts: an escaped
 * rejection on native never reaches lib/boot/rejection-handler.ts.
 */
export function useContentEditing(
  branchId: string,
  ctx: DbCtx,
  reload: () => Promise<void>,
): (entryId: string, content: string) => Promise<EditResult> {
  return useCallback(
    async (entryId: string, content: string): Promise<EditResult> => {
      try {
        const result = await updateStoryEntryContent(branchId, entryId, content, ctx)
        if (result.status === 'ok') return { ok: true }
        logger.warn('action_layer.content_edit_rejected', {
          branchId,
          entryId,
          reason: result.reason,
          code: result.code,
        })
        toast.error(t('reader:editFailed'))
        return { ok: false, code: result.code }
      } catch (err) {
        logger.error('action_layer.content_edit_failed', {
          branchId,
          entryId,
          error: err instanceof Error ? err.message : String(err),
        })
        toast.error(t('reader:editFailed'))
        // A DeltaReplayError can commit the edit and fail the store sync, leaving the
        // store on the old prose; a retried Save would then see no change and close.
        await reload().catch((reloadErr: unknown) =>
          logger.error('action_layer.content_edit_resync_failed', {
            branchId,
            error: reloadErr instanceof Error ? reloadErr.message : String(reloadErr),
          }),
        )
        return { ok: false }
      }
    },
    [branchId, ctx, reload],
  )
}
