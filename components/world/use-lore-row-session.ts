import { useCallback, useEffect } from 'react'
import type { Resolver } from 'react-hook-form'

import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveSession,
  type RowSessionHandle,
} from '@/hooks/use-row-save-session'
import type { LoreSaveResult } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import type { LoreDraft } from '@/lib/world'

import { loreFieldLabel, loreIssueText, saveFailureText, saveRejectionText } from './world-copy'

type LoreRowSessionOptions = {
  /** Null in create mode. */
  rowId: string | null
  /** Create mode's `seq`: a new value is a fresh draft, even while already creating. */
  createSeq?: number
  /** The committed values; memoize by row identity. */
  values: LoreDraft
  resolver: Resolver<LoreDraft>
  onSave: (draft: LoreDraft) => Promise<LoreSaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  /** A save failed, with its translated reason. */
  onRejected?: (reason: string) => void
  /** The surface routes row switches, `←`, category switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
}

/** The lore pane's row save session: translated refusals, and its handle to the route. */
export function useLoreRowSession({
  rowId,
  createSeq = 0,
  values,
  resolver,
  onSave,
  onSaved,
  onRejected,
  onSession,
}: LoreRowSessionOptions): RowSaveSession<LoreDraft> {
  const commit = useCallback(
    async (draft: LoreDraft): Promise<RowCommitResult> => {
      const result = await onSave(draft)
      if (result.status === 'rejected') {
        return { status: 'rejected', reason: saveRejectionText(result.code) }
      }
      // The write landed: a throwing onSaved must not read as failed, or a retry creates it twice.
      try {
        onSaved(result.id)
      } catch (error) {
        logger.error('app.lore_saved_handler_failed', {
          id: result.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return { status: 'ok' }
    },
    [onSave, onSaved],
  )
  const session = useRowSaveSession<LoreDraft>({
    rowKey: rowId ?? `create:lore:${createSeq}`,
    values,
    resolver,
    fieldLabel: loreFieldLabel,
    issueText: loreIssueText,
    failureText: saveFailureText,
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
