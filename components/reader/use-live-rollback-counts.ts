import { useEffect, useRef } from 'react'

import type { RollbackCounts, StoryEntryRejection } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'

/**
 * Keeps an open rollback or regenerate confirm's counts true while a run settles under it,
 * typically a pass committing (rollback-confirm.md → Counts). Recounts on each settle after
 * the modal opened, never on open, since the opener just counted. A refused or failed
 * recount keeps the shown counts; the action's confirm-time check still guards the commit.
 */
export function useLiveRollbackCounts({
  branchId,
  target,
  load,
  onCounts,
}: {
  branchId: string
  target: { targetId: string; counts: RollbackCounts } | null
  load: (branchId: string, targetId: string) => Promise<RollbackCounts | StoryEntryRejection>
  onCounts: (counts: RollbackCounts) => void
}): void {
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const targetId = target?.targetId ?? null
  // The recount effect's cleanup is what drops a stale recount, so a host's fresh callbacks
  // each render must not re-run it: they ride in a ref.
  const latest = useRef({ load, onCounts })
  useEffect(() => {
    latest.current = { load, onCounts }
  })
  const countedAt = useRef<{ targetId: string; settle: number } | null>(null)

  useEffect(() => {
    if (targetId == null) {
      countedAt.current = null
      return undefined
    }
    const counted = countedAt.current
    countedAt.current = { targetId, settle: settleCount }
    if (counted == null || counted.targetId !== targetId || counted.settle === settleCount)
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
  }, [branchId, targetId, settleCount])
}
