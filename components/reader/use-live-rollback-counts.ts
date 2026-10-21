import { useEffect, useRef } from 'react'

import type { RollbackCounts, StoryEntryRejection } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'

/**
 * Keeps an open rollback or regenerate confirm's counts true while a run settles under it,
 * typically a pass committing (rollback-confirm.md → Counts). Recounts whenever the settle count
 * is past `countedAtSettle`, the one its counts were read at. A refused or failed recount keeps
 * the shown counts; the action's confirm-time check still guards the commit.
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
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const targetId = target?.targetId ?? null
  const countedAtSettle = target?.countedAtSettle ?? null
  // The recount effect's cleanup is what drops a stale recount, so a host's fresh callbacks
  // each render must not re-run it: they ride in a ref.
  const latest = useRef({ load, onCounts })
  useEffect(() => {
    latest.current = { load, onCounts }
  })

  useEffect(() => {
    if (targetId == null || countedAtSettle == null || settleCount <= countedAtSettle)
      return undefined
    let live = true
    latest.current.load(branchId, targetId).then(
      (result) => {
        if (!live) return
        if ('status' in result) {
          logger.warn('reader.rollback_recount_rejected', {
            branchId,
            entryId: targetId,
            code: result.code,
            reason: result.reason,
          })
          return
        }
        latest.current.onCounts(result)
      },
      (error: unknown) => {
        if (!live) return
        logger.error('reader.rollback_recount_failed', {
          branchId,
          entryId: targetId,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
    return () => {
      live = false
    }
  }, [branchId, targetId, countedAtSettle, settleCount])
}
