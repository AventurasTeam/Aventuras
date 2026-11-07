import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect } from 'react'

import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveSession,
  type RowSessionHandle,
} from '@/hooks/use-row-save-session'
import type { ChapterSaveResult } from '@/lib/actions'
import { chapterDraftSchema, type ChapterDraft } from '@/lib/chapters'
import { logger } from '@/lib/diagnostics'

import {
  chapterFieldLabel,
  chapterIssueText,
  chapterSaveFailureText,
  chapterSaveRejectionText,
} from './chapter-copy'

/** The rowKey while no card is open; chapter ids are `chap_…`, so it never names a row. */
export const CHAPTER_SESSION_NONE = 'none'

const resolver = zodResolver(chapterDraftSchema)

export type ChapterRowSessionOptions = {
  /** The expanded chapter's id; null while no card is open. */
  rowId: string | null
  /** The committed values; memoize by row identity. EMPTY_CHAPTER_DRAFT's copy while rowId is null. */
  values: ChapterDraft
  onSave: (draft: ChapterDraft) => Promise<ChapterSaveResult>
  onSaved: (id: string) => void
  onRejected?: (reason: string) => void
  onSession: (handle: RowSessionHandle | null) => void
}

/** The Timeline's one row save session: translated refusals, and its handle to the route. */
export function useChapterRowSession({
  rowId,
  values,
  onSave,
  onSaved,
  onRejected,
  onSession,
}: ChapterRowSessionOptions): RowSaveSession<ChapterDraft> {
  const commit = useCallback(
    async (draft: ChapterDraft): Promise<RowCommitResult> => {
      const result = await onSave(draft)
      if (result.status === 'rejected') {
        return { status: 'rejected', reason: chapterSaveRejectionText(result.code) }
      }
      // The write landed: a throwing handler must not read as a failed save.
      try {
        onSaved(result.id)
      } catch (error) {
        logger.error('app.chapter_saved_handler_failed', {
          id: result.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return { status: 'ok' }
    },
    [onSave, onSaved],
  )
  const session = useRowSaveSession<ChapterDraft>({
    rowKey: rowId ?? CHAPTER_SESSION_NONE,
    values,
    resolver,
    fieldLabel: chapterFieldLabel,
    issueText: chapterIssueText,
    failureText: chapterSaveFailureText,
    commit,
    onRejected,
  })
  const { form, dirty, requestLeave } = session
  // Undoing every edit leaves the edited fields' issues behind; a clean draft shows none.
  useEffect(() => {
    if (!dirty) form.clearErrors()
  }, [dirty, form])
  useEffect(() => {
    onSession({ dirty, requestLeave })
    return () => onSession(null)
  }, [onSession, dirty, requestLeave])
  return session
}
