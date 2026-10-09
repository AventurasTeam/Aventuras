import { useRef, useState, type RefObject } from 'react'

/** What an editor form reports about its draft. `invalidReason` is why Save is unavailable. */
export type EditDraft = { dirty: boolean; invalidReason?: string }

/** `save()` runs the form's own Save path, as its Save button does. */
export type EditFormHandle = { save: () => void }

type EditOverlayGuardDialog = {
  open: boolean
  saving: boolean
  saveDisabled: boolean
  saveDisabledReason?: string
  reason?: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

type EditOverlayGuard = {
  formRef: RefObject<EditFormHandle | null>
  onDraftChange: (draft: EditDraft) => void
  /** A dismissal can't close the overlay now: a save is in flight or the draft is unsaved. */
  held: boolean
  /** A dismissal: closes a clean editor, raises the guard over a dirty one, waits out a save. */
  requestClose: () => void
  /** Closes outright, for an explicit Cancel or a landed save. */
  close: () => void
  /** Spread onto `UnsavedChangesDialog`. */
  dialog: EditOverlayGuardDialog
}

const CLEAN: EditDraft = { dirty: false }

/**
 * save-sessions.md → Navigate-away guard for an editor overlay (Sheet or Dialog): a dismissal
 * over unsaved input raises Save / Discard / Cancel instead of dropping the draft.
 */
export function useEditOverlayGuard({
  saving,
  saveError,
  onClose,
}: {
  saving: boolean
  saveError?: string
  onClose: () => void
}): EditOverlayGuard {
  const formRef = useRef<EditFormHandle>(null)
  const [draft, setDraft] = useState<EditDraft>(CLEAN)
  const [raised, setRaised] = useState(false)

  // Clears the guard too: a Dialog host stays mounted, so a raised guard would outlive the close.
  const close = () => {
    setRaised(false)
    onClose()
  }

  return {
    formRef,
    onDraftChange: setDraft,
    held: saving || draft.dirty,
    requestClose: () => {
      if (saving) return
      if (draft.dirty) setRaised(true)
      else close()
    },
    close,
    dialog: {
      open: raised,
      saving,
      saveDisabled: draft.invalidReason != null,
      saveDisabledReason: draft.invalidReason,
      reason: draft.invalidReason ?? saveError,
      onSave: () => formRef.current?.save(),
      onDiscard: close,
      onCancel: () => setRaised(false),
    },
  }
}
