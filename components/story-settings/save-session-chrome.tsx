import { View } from 'react-native'

import { SaveBar } from '@/components/compounds/save-bar'
import { UnsavedChangesDialog } from '@/components/compounds/unsaved-changes-dialog'
import { t } from '@/lib/i18n'

import { DefinitionalChangeDialog } from './definitional-change-dialog'
import { useStorySettingsSaveSession } from './save-session'
import type { SaveSessionSnapshot } from './save-session-state'

type DialogGateProps = {
  blocked?: boolean
  disabledReason?: string
}

/** Tab-prefixed: the refusing section may sit on a tab the user isn't viewing. */
function qualifiedReason(snapshot: SaveSessionSnapshot): string | undefined {
  if (snapshot.invalidReason == null) return undefined
  if (snapshot.invalidTab == null) return snapshot.invalidReason
  return t('storySettings:save.invalidOnTab', {
    tab: t(`storySettings:tabs.${snapshot.invalidTab}`),
    reason: snapshot.invalidReason,
  })
}

/** The surface's save bar, mounted only while the session is dirty. */
export function StorySettingsSaveBar({
  enabled,
  blocked = false,
  disabledReason,
}: {
  enabled: boolean
  blocked?: boolean
  disabledReason?: string
}) {
  const session = useStorySettingsSaveSession()
  const { dirtyFields } = session.snapshot
  const invalidReason = qualifiedReason(session.snapshot)
  if (dirtyFields.length === 0) return null
  return (
    <SaveBar
      dirtyFields={dirtyFields}
      dirtyCount={dirtyFields.length}
      saving={session.saving}
      enabled={enabled && !blocked}
      notice={invalidReason ?? (blocked ? disabledReason : undefined)}
      saveDisabled={blocked || invalidReason != null}
      saveDisabledReason={blocked ? disabledReason : invalidReason}
      onSave={() => void session.save()}
      onDiscard={session.discard}
    />
  )
}

/**
 * No focus gate: `requestLeave` only fires while focused, so a pending leave while unfocused is
 * a window close — gating there holds that close open with nothing to answer it, unclosable.
 * Hidden while a confirmation is pending: the two never stack.
 */
function StorySettingsLeaveDialog({ blocked = false, disabledReason }: DialogGateProps) {
  const session = useStorySettingsSaveSession()
  const invalidReason = qualifiedReason(session.snapshot)
  return (
    <UnsavedChangesDialog
      open={session.pendingLeave && !session.pendingConfirmation}
      saving={session.saving}
      saveDisabled={blocked || invalidReason != null}
      saveDisabledReason={blocked ? disabledReason : invalidReason}
      reason={invalidReason ?? (blocked ? disabledReason : undefined)}
      onSave={() => session.resolveLeave('save')}
      onDiscard={() => session.resolveLeave('discard')}
      onCancel={() => session.resolveLeave('cancel')}
    />
  )
}

function StorySettingsConfirmDialog() {
  const session = useStorySettingsSaveSession()
  return (
    <DefinitionalChangeDialog
      open={session.pendingConfirmation}
      fields={session.snapshot.flaggedFields}
      saving={session.saving}
      onCancel={() => session.resolveConfirmation('cancel')}
      onConfirm={() => session.resolveConfirmation('save')}
    />
  )
}

/** Paired: the leave dialog yields to the confirmation, so alone it can strand a window close. */
export function StorySettingsDialogs({ blocked, disabledReason }: DialogGateProps) {
  // One element: a Fragment would leak each dialog root's View into the host's layout as siblings.
  return (
    <View>
      <StorySettingsLeaveDialog blocked={blocked} disabledReason={disabledReason} />
      <StorySettingsConfirmDialog />
    </View>
  )
}
