import { SaveBar } from '@/components/compounds/save-bar'

import { useStorySettingsSaveSession } from './save-session'
import { UnsavedChangesDialog } from './unsaved-changes-dialog'

/** The surface's save bar, mounted only while the session is dirty. */
export function StorySettingsSaveBar({ enabled }: { enabled: boolean }) {
  const session = useStorySettingsSaveSession()
  const { dirtyFields, invalidReason } = session.snapshot
  if (dirtyFields.length === 0) return null
  return (
    <SaveBar
      dirtyFields={dirtyFields}
      dirtyCount={dirtyFields.length}
      saving={session.saving}
      enabled={enabled}
      notice={invalidReason}
      saveDisabled={invalidReason != null}
      onSave={() => void session.save()}
      onDiscard={session.discard}
    />
  )
}

/**
 * No focus gate: every `requestLeave` caller can only fire while the surface is
 * focused, so a pending leave while unfocused means the user is closing the
 * window — exactly when the dialog must show. Gating it there holds the close
 * open with nothing on screen to answer it, leaving the window unclosable.
 */
export function StorySettingsLeaveDialog() {
  const session = useStorySettingsSaveSession()
  const { invalidReason } = session.snapshot
  return (
    <UnsavedChangesDialog
      open={session.pendingLeave}
      saving={session.saving}
      saveDisabled={invalidReason != null}
      reason={invalidReason}
      onSave={() => session.resolveLeave('save')}
      onDiscard={() => session.resolveLeave('discard')}
      onCancel={() => session.resolveLeave('cancel')}
    />
  )
}
