import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FieldValues, Path, Resolver, UseFormReturn } from 'react-hook-form'

import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveConfirm,
  type RowSaveSession,
  type RowSessionHandle,
} from '@/hooks/use-row-save-session'
import type { EntitySaveResult } from '@/lib/actions'
import type { EntityKind } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { EntityBaseDraft } from '@/lib/world'

import {
  placeRefusalNotice,
  placeRefusalText,
  saveFailureText,
  saveRejectionText,
} from './world-copy'

type RefusalFields<Draft extends FieldValues> = Readonly<
  Partial<Record<string, { field: Path<Draft>; message: string }>>
>

type EntityDraft = FieldValues & EntityBaseDraft

type EntityRowSessionOptions<Draft extends EntityDraft> = {
  kind: EntityKind
  /** Null in create mode. */
  rowId: string | null
  /** Create mode's `seq`: a new value is a fresh draft, even while already creating. */
  createSeq?: number
  /** The committed values; memoize by row identity. */
  values: Draft
  resolver: Resolver<Draft>
  fieldLabel: (field: string) => string
  issueText: (message: string) => string
  onSave: (draft: Draft) => Promise<EntitySaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  onRejected?: (reason: string) => void
  /** The surface routes row switches, `←`, category switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
  /** A refusal code the pane shows on a field (`parent-cycle` → the parent picker). Stable. */
  fieldErrors?: RefusalFields<Draft>
  /** What a Save asks before it writes (a place's cascade); see `useRowSaveSession`. */
  confirmBeforeCommit?: (draft: Draft) => RowSaveConfirm | null
}

/** A World detail pane's row save session: translated refusals, field errors, route handle. */
export function useEntityRowSession<Draft extends EntityDraft>({
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
  fieldErrors,
  confirmBeforeCommit,
}: EntityRowSessionOptions<Draft>): RowSaveSession<Draft> {
  const rowKey = rowId ?? `create:${kind}:${createSeq}`
  const formRef = useRef<UseFormReturn<Draft> | null>(null)
  const rowKeyRef = useRef(rowKey)
  // The refused field shows the rule's text; the bar's notice adds the tab the field is on.
  const [placeNotice, setPlaceNotice] = useState<{ message: string; notice: string } | null>(null)
  const sessionIssueText = useCallback(
    (message: string) =>
      message === placeNotice?.message ? placeNotice.notice : issueText(message),
    [issueText, placeNotice],
  )
  const commit = useCallback(
    async (draft: Draft): Promise<RowCommitResult> => {
      const startKey = rowKeyRef.current
      const result = await onSave(draft)
      if (result.status === 'rejected') {
        // A place rule names its own field and places (world.md → Settings).
        const { refusal } = result
        const place =
          refusal == null
            ? null
            : {
                field: refusal.field as Path<Draft>,
                message: placeRefusalText(refusal),
                notice: placeRefusalNotice(refusal),
              }
        const target = place ?? fieldErrors?.[result.code]
        // A row switch while the write was in flight: this refusal is no longer this row's to show.
        if (target != null && rowKeyRef.current === startKey) {
          if (place != null) setPlaceNotice({ message: place.message, notice: place.notice })
          formRef.current?.setError(target.field, { type: 'server', message: target.message })
        }
        return { status: 'rejected', reason: place?.notice ?? saveRejectionText(result.code) }
      }
      // The write landed: a throwing onSaved must not read as failed, or a retry creates it twice.
      try {
        onSaved(result.id)
      } catch (error) {
        logger.error('app.entity_saved_handler_failed', {
          kind,
          id: result.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return { status: 'ok' }
    },
    [kind, onSave, onSaved, fieldErrors],
  )
  const session = useRowSaveSession<Draft>({
    rowKey,
    values,
    resolver,
    fieldLabel,
    issueText: sessionIssueText,
    failureText: saveFailureText,
    commit,
    confirmBeforeCommit,
    onRejected,
  })
  const { form, dirty, requestLeave } = session
  useLayoutEffect(() => {
    formRef.current = form
    rowKeyRef.current = rowKey
  })
  useEffect(() => {
    onSession({ dirty, requestLeave })
    return () => onSession(null)
  }, [onSession, dirty, requestLeave])
  return session
}
