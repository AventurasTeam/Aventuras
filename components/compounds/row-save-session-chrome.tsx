import type { FieldValues } from 'react-hook-form'

import type { RowSaveSession } from '@/hooks/use-row-save-session'

import { SaveBar } from './save-bar'
import { UnsavedChangesDialog } from './unsaved-changes-dialog'

type Gate = {
  /** `isUserEditBlocked` — Save disables with the principle-owned reason. */
  blocked?: boolean
  blockedReason?: string
}

type RowSaveBarProps<Draft extends FieldValues> = Gate & {
  session: RowSaveSession<Draft>
  /** The host screen's focus state, forwarded to the Cmd/Ctrl-S hotkey. */
  enabled?: boolean
}

/** The pane's save bar, mounted only while the session is dirty (DetailPane's `saveBar` slot). */
export function RowSaveBar<Draft extends FieldValues>({
  session,
  enabled = true,
  blocked = false,
  blockedReason,
}: RowSaveBarProps<Draft>) {
  if (!session.dirty) return null
  const invalid = session.invalidReason ?? undefined
  return (
    <SaveBar
      dirtyFields={session.dirtyFields}
      saving={session.saving}
      // Not gated on `blocked`: saveDisabled refuses the save while Ctrl-S stays claimed.
      enabled={enabled}
      notice={invalid ?? session.saveError ?? (blocked ? blockedReason : undefined)}
      saveDisabled={blocked || invalid != null}
      saveDisabledReason={blocked ? blockedReason : invalid}
      onSave={() => void session.save()}
      onDiscard={session.discard}
    />
  )
}

type RowLeaveDialogProps<Draft extends FieldValues> = Gate & { session: RowSaveSession<Draft> }

/** Save / Discard / Cancel for a queued leave (save-sessions.md → Navigate-away guard). */
export function RowLeaveDialog<Draft extends FieldValues>({
  session,
  blocked = false,
  blockedReason,
}: RowLeaveDialogProps<Draft>) {
  const invalid = session.invalidReason ?? undefined
  return (
    <UnsavedChangesDialog
      open={session.pendingLeave}
      saving={session.saving}
      saveDisabled={blocked || invalid != null}
      saveDisabledReason={blocked ? blockedReason : invalid}
      reason={invalid ?? session.saveError ?? (blocked ? blockedReason : undefined)}
      onSave={() => session.resolveLeave('save')}
      onDiscard={() => session.resolveLeave('discard')}
      onCancel={() => session.resolveLeave('cancel')}
    />
  )
}
