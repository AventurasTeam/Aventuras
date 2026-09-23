import { useCallback, useEffect } from 'react'
import type { FieldValues, Resolver } from 'react-hook-form'

import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveSession,
  type RowSessionHandle,
} from '@/hooks/use-row-save-session'
import type { PlotSaveResult } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import type { PlotKind } from '@/lib/list-modules'

import { saveFailureText, saveRejectionText } from './plot-copy'

type PlotRowSessionOptions<Draft extends FieldValues> = {
  kind: PlotKind
  /** Null in create mode. */
  rowId: string | null
  /** Create mode's `seq`: a new value is a fresh draft, even while already creating. */
  createSeq?: number
  /** The committed values; memoize by row identity. */
  values: Draft
  resolver: Resolver<Draft>
  fieldLabel: (field: string) => string
  issueText: (message: string) => string
  onSave: (draft: Draft) => Promise<PlotSaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  /** A save failed, with its translated reason. */
  onRejected?: (reason: string) => void
  /** The surface routes row switches, `←`, segment switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
}

/** A Plot detail pane's row save session: translated refusals, and its handle to the route. */
export function usePlotRowSession<Draft extends FieldValues>({
  kind,
  rowId,
  createSeq = 0,
  values,
  resolver,
  fieldLabel,
  issueText,
  onSave,
  onSaved,
  onRejected,
  onSession,
}: PlotRowSessionOptions<Draft>): RowSaveSession<Draft> {
  const commit = useCallback(
    async (draft: Draft): Promise<RowCommitResult> => {
      const result = await onSave(draft)
      if (result.status === 'rejected') {
        return { status: 'rejected', reason: saveRejectionText(result.code) }
      }
      // The write landed: a throwing handler must not read as a failed save, or a retry
      // would create the row twice.
      try {
        onSaved(result.id)
      } catch (error) {
        logger.error('app.plot_saved_handler_failed', {
          kind,
          id: result.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return { status: 'ok' }
    },
    [kind, onSave, onSaved],
  )
  const session = useRowSaveSession<Draft>({
    rowKey: rowId ?? `create:${kind}:${createSeq}`,
    values,
    resolver,
    fieldLabel,
    issueText,
    failureText: saveFailureText,
    commit,
    onRejected,
  })
  const { dirty, requestLeave } = session
  useEffect(() => {
    onSession({ dirty, requestLeave })
    return () => onSession(null)
  }, [onSession, dirty, requestLeave])
  return session
}
