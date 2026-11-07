import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveSession,
  type RowSessionHandle,
} from '@/hooks/use-row-save-session'
import type { ChapterSaveResult } from '@/lib/actions'
import {
  chapterDraftFrom,
  chapterDraftSchema,
  type ChapterDraft,
  type ChapterDraftRow,
} from '@/lib/chapters'
import { logger } from '@/lib/diagnostics'

import {
  chapterFieldLabel,
  chapterIssueText,
  chapterSaveFailureText,
  chapterSaveRejectionText,
} from './chapter-copy'

/** The rowKey while no card is open; chapter ids are `chap_…`, so it never names a row. */
const CHAPTER_SESSION_NONE = 'none'

// No field renders while no card is open, so no Save can reach this; it writes nothing.
const NO_CHAPTER_OPEN: ChapterSaveResult = {
  status: 'rejected',
  reason: 'no chapter open',
  code: 'failed',
}

const resolver = zodResolver(chapterDraftSchema)

export type ChapterRowSession = RowSaveSession<ChapterDraft> & {
  /** The row whose values the form holds; a switch reaches it one layout pass after `rowId`. */
  formRowId: string | null
}

export type ChapterRowSessionOptions = {
  /** The expanded chapter, whose identity keys its committed values; null while no card is open. */
  row: ChapterDraftRow | null
  onSave: (row: ChapterDraftRow, draft: ChapterDraft) => Promise<ChapterSaveResult>
  onSaved: (id: string) => void
  onRejected?: (reason: string) => void
  onSession: (handle: RowSessionHandle | null) => void
}

/** The Timeline's one row save session: translated refusals, and its handle to the route. */
export function useChapterRowSession({
  row,
  onSave,
  onSaved,
  onRejected,
  onSession,
}: ChapterRowSessionOptions): ChapterRowSession {
  const rowId = row?.id ?? null
  const values = useMemo(() => chapterDraftFrom(row), [row])
  const commit = useCallback(
    async (draft: ChapterDraft): Promise<RowCommitResult> => {
      const result = row == null ? NO_CHAPTER_OPEN : await onSave(row, draft)
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
    [row, onSave, onSaved],
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
  // react-hook-form subscribes a native field passively, so one mounted with the switch misses the
  // session's reset. A layout effect: its re-render follows that reset and lands before paint.
  const [formRowId, setFormRowId] = useState(rowId)
  useLayoutEffect(() => setFormRowId(rowId), [rowId])
  return { ...session, formRowId }
}
