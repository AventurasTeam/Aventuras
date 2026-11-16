import { useIsFocused } from '@react-navigation/native'
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'

import { UnsavedChangesDialog } from '@/components/compounds/unsaved-changes-dialog'
import type { EditResult, EditSession } from '@/components/reader/reader-document-types'
import { STORY_ENTRY_REJECTION } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'

import { useRowSessionGuard } from './use-row-session-guard'

/** A document that didn't answer in time: the leave can't learn whether the draft is dirty. */
export const UNRESPONSIVE = 'unresponsive'

/** How the guard reaches the surface's editor: in-process on web, over the bridge on native. */
export type InlineEditPort = {
  query: () => Promise<EditSession | null | typeof UNRESPONSIVE>
  /** The editor's plain Save; never rejects. */
  commit: () => Promise<EditResult | typeof UNRESPONSIVE>
  discard: () => void
}

/** `id` is the query that opened it; a late answer or Save applies only while it's current. */
type Pending = { id: number; saving: boolean; reason: string | null; unresponsive: boolean }

type InlineEditGuard = {
  guard: (proceed: () => void) => void
  navigateGuarded: (path: string) => void
  dialog: JSX.Element | null
}

/** Why the guard's Save was refused; a gated write names the run, anything else retries. */
export function editRefusalReason(code: string | undefined): string {
  return code === STORY_ENTRY_REJECTION.inFlight
    ? t('reader:actions.blockedWhileGenerating')
    : t('reader:editFailed')
}

/**
 * reader-composer.md → Inline edit session: every leave asks the editor whether its draft is
 * dirty and, if it is, waits behind Save / Discard / Cancel. Save is the editor's plain Save, held
 * by `saveGate` as the editor's own is; a refused Save keeps the dialog with its reason.
 *
 * @param armed - Whether a leave must ask first: the reported dirty on web, an open editor on
 *   native, where a dirty report can still be crossing the bridge.
 */
export function useInlineEditGuard({
  port,
  armed,
  saveGate,
}: {
  port: InlineEditPort
  armed: boolean
  saveGate: { disabled: boolean; reason: string | undefined }
}): InlineEditGuard {
  const { onSession, guard, navigateGuarded } = useRowSessionGuard()
  const isFocused = useIsFocused()
  const [pending, setPending] = useState<Pending | null>(null)
  // Leaves queued behind one question: a second leave while the first asks waits on its answer.
  const intentsRef = useRef<(() => void)[]>([])
  const querySeqRef = useRef(0)
  const askingRef = useRef<number | null>(null)
  const openRef = useRef<number | null>(null)
  const portRef = useRef(port)
  const armedRef = useRef(armed)
  useEffect(() => {
    portRef.current = port
    armedRef.current = armed
  })

  const show = useCallback((next: Pending | null) => {
    openRef.current = next?.id ?? null
    setPending(next)
  }, [])

  const settle = useCallback(() => {
    const intents = intentsRef.current
    intentsRef.current = []
    show(null)
    // As World's leave queue: one leave that throws must not strand the ones behind it.
    for (const proceed of intents) {
      try {
        proceed()
      } catch (error) {
        logger.error('reader.edit_guard_leave_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }, [show])

  const requestLeave = useCallback(
    (proceed: () => void) => {
      const busy = openRef.current != null || askingRef.current != null
      if (!armedRef.current && !busy) {
        proceed()
        return
      }
      intentsRef.current = [...intentsRef.current, proceed]
      if (busy) return
      const id = ++querySeqRef.current
      askingRef.current = id
      void portRef.current.query().then((answer) => {
        // Forgotten when the screen lost focus: the draft may have changed since it was asked.
        if (askingRef.current !== id) return
        askingRef.current = null
        if (answer === UNRESPONSIVE) {
          logger.warn('reader.edit_guard_unresponsive', { step: 'query' })
          show({
            id,
            saving: false,
            reason: t('reader:editGuard.unresponsive'),
            unresponsive: true,
          })
        } else if (answer?.dirty === true)
          show({ id, saving: false, reason: null, unresponsive: false })
        else settle()
      })
    },
    [settle, show],
  )

  useEffect(() => {
    onSession({ dirty: armed, requestLeave })
    return () => onSession(null)
  }, [onSession, armed, requestLeave])

  // Replayed later, a leave held on a screen that lost focus would navigate unasked.
  useEffect(() => {
    if (isFocused) return
    intentsRef.current = []
    askingRef.current = null
    show(null)
  }, [isFocused, show])

  const save = useCallback(() => {
    if (pending == null || pending.saving || pending.unresponsive) return
    const { id } = pending
    show({ ...pending, saving: true })
    void portRef.current
      .commit()
      .catch((err: unknown): EditResult => {
        logger.error('reader.edit_guard_commit_threw', {
          error: err instanceof Error ? err.message : String(err),
        })
        return { ok: false }
      })
      .then((result) => {
        // Its dialog closed meanwhile; settling a newer one would release a leave it never asked.
        if (openRef.current !== id) return
        if (result === UNRESPONSIVE) {
          logger.warn('reader.edit_guard_unresponsive', { step: 'commit' })
          show({
            id,
            saving: false,
            reason: t('reader:editGuard.unresponsive'),
            unresponsive: false,
          })
        } else if (result.ok) settle()
        else
          show({ id, saving: false, reason: editRefusalReason(result.code), unresponsive: false })
      })
  }, [pending, settle, show])

  const discard = useCallback(() => {
    if (pending?.saving === true) return
    portRef.current.discard()
    settle()
  }, [pending, settle])

  const cancel = useCallback(() => {
    intentsRef.current = []
    show(null)
  }, [show])

  // Gated on focus: a pushed-under screen's portaled dialog would float over the one above
  // (lessons-learned/portaled-overlay-outlives-screen-focus.md).
  const dialog = isFocused ? (
    <UnsavedChangesDialog
      open={pending != null}
      saving={pending?.saving ?? false}
      saveDisabled={saveGate.disabled || pending?.unresponsive === true}
      saveDisabledReason={
        pending?.unresponsive === true ? t('reader:editGuard.unresponsive') : saveGate.reason
      }
      reason={pending?.reason ?? undefined}
      onSave={save}
      onDiscard={discard}
      onCancel={cancel}
    />
  ) : null

  return { guard, navigateGuarded, dialog }
}
