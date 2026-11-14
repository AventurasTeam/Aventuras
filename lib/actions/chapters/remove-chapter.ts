import { generationStore } from '@/lib/stores'

import {
  CHAPTER_DELETE_REFUSAL,
  resolveChapterDeleteSet,
  type ChapterDeleteMode,
  type ChapterDeleteRefusal,
} from './chapter-delete-set'
import { ReversalIntegrityError } from '../delta/replay-errors'
import { commitNewAction, logReversalRefused } from '../story-entries/operational'
import { bracketProseReversal } from '../story-entries/prose-reversal'
import type { DbCtx } from '../types'

export type RemoveChapterResult = { status: 'ok' } | ChapterDeleteRefusal

/**
 * C13: reverses the latest chapter's close groups whole, or only its row, report and stamps; every
 * entry stays. Not undoable, and clears redo.
 */
export async function removeChapter(
  branchId: string,
  chapterId: string,
  mode: ChapterDeleteMode,
  ctx: DbCtx,
): Promise<RemoveChapterResult> {
  // No await before the bracket: this check and its flag set stay one synchronous block, so a
  // second press is refused, not thrown as re-entry.
  if (generationStore.isUserEditBlocked())
    return {
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.inFlight,
      reason: 'generation in flight',
    }
  return bracketProseReversal(branchId, ctx, async (): Promise<RemoveChapterResult> => {
    const resolved = await resolveChapterDeleteSet(branchId, chapterId, mode, ctx)
    if ('status' in resolved) return resolved
    try {
      // No clamp: no entry goes, and a close never moves the watermark.
      await commitNewAction(resolved.set, ctx, [])
    } catch (e) {
      if (!(e instanceof ReversalIntegrityError)) throw e
      logReversalRefused(branchId, e)
      return { status: 'rejected', code: CHAPTER_DELETE_REFUSAL.integrity, reason: e.message }
    }
    return { status: 'ok' }
  })
}
