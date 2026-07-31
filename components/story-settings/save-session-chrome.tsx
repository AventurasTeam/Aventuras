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
 * No focus gate: `pendingLeave` is only set by the surface's own back arrow or
 * the window-close guard, and a pushed-under screen's back arrow can't fire —
 * so a pending leave while unfocused means the user is closing the window,
 * which is exactly when the dialog must show.
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
