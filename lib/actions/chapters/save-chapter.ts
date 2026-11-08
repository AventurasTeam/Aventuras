import { chapterActions, type ChapterDraft, type ChapterDraftRow } from '@/lib/chapters'

import {
  commitRowSave,
  flatRowSaveResult,
  type FlatRowSaveRejectionCode,
  type FlatRowSaveResult,
} from '../row-save/commit-row-save'
import type { DbCtx } from '../types'

export type ChapterSaveResult = FlatRowSaveResult

export type ChapterSaveRejectionCode = FlatRowSaveRejectionCode

type SaveChapterArgs = { row: ChapterDraftRow; draft: ChapterDraft }

/** One Timeline card Save: the changed columns as one `updateChapter`, or nothing. */
export function saveChapter(
  { row, draft }: SaveChapterArgs,
  ctx: DbCtx,
): Promise<ChapterSaveResult> {
  // Update-only: a chapter row exists only once a close has written it.
  return commitRowSave(
    'chapter',
    {
      branchId: row.branchId,
      rowId: row.id,
      build: () => chapterActions({ row, draft }),
    },
    ctx,
  ).then(flatRowSaveResult)
}
