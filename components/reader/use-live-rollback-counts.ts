import { useSettleReread } from '@/hooks/use-settle-reread'
import type { RollbackCounts, StoryEntryRejection } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'

/**
 * Recounts an open rollback or regenerate confirm whenever the settle count exceeds the
 * `countedAtSettle` its counts were read at (rollback-confirm.md → Counts). A refused or failed
 * recount keeps the shown counts; the action's confirm-time check still guards the commit.
 */
export function useLiveRollbackCounts({
  branchId,
  target,
  load,
  onCounts,
}: {
  branchId: string
  target: { targetId: string; countedAtSettle: number } | null
  load: (branchId: string, targetId: string) => Promise<RollbackCounts | StoryEntryRejection>
  onCounts: (counts: RollbackCounts) => void
}): void {
  const targetId = target?.targetId ?? null
  useSettleReread({
    targetKey: targetId == null ? null : `${branchId}:${targetId}`,
    countedAtSettle: target?.countedAtSettle ?? null,
    onSettle: (isLive) => {
      if (targetId == null) return
      load(branchId, targetId).then(
        (result) => {
          if (!isLive()) return
          if ('status' in result) {
            logger.warn('reader.rollback_recount_rejected', {
              branchId,
              entryId: targetId,
              code: result.code,
              reason: result.reason,
            })
            return
          }
          onCounts(result)
        },
        (error: unknown) => {
          if (!isLive()) return
          logger.error('reader.rollback_recount_failed', {
            branchId,
            entryId: targetId,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      )
    },
  })
}
