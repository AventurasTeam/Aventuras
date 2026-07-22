import { useIsFocused } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { SaveBar } from '@/components/compounds/save-bar'
import { ScreenShell } from '@/components/shells/screen-shell'
import { StorySettingsShell } from '@/components/shells/story-settings-shell'
import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
} from '@/components/story-settings/save-session'
import {
  isStorySettingsTabId,
  STORY_SETTINGS_TAB_GROUPS,
  type StorySettingsTabId,
} from '@/components/story-settings/tabs'
import { UnsavedChangesDialog } from '@/components/story-settings/unsaved-changes-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useTier } from '@/hooks/use-tier'
import { updateStorySettings } from '@/lib/actions'
import { db, runInTransaction, type StorySettings } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { awaitRunTerminal, PER_TURN_KIND } from '@/lib/pipeline'
import { generationStore, rehydrateStories, storiesStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

export default function StorySettingsRoute() {
  const { storyId } = useLocalSearchParams<{ storyId: string }>()
  // All three are in the provider's `save` dep chain; inline arrows would give
  // every consumer a new context identity on each render.
  const onCommit = useCallback(
    (patch: Partial<StorySettings>) => updateStorySettings(storyId, patch, ctx),
    [storyId],
  )
  const onSaved = useCallback(() => toast.success(t('storySettings:save.saved')), [])
  const onSaveFailed = useCallback(
    (error: unknown) => {
      logger.error('action_layer.story_settings_save_failed', {
        storyId,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error(t('storySettings:save.failed'))
    },
    [storyId],
  )
  return (
    <StorySettingsSaveSessionProvider
      onCommit={onCommit}
      onSaved={onSaved}
      onSaveFailed={onSaveFailed}
    >
      <StorySettingsSurface />
    </StorySettingsSaveSessionProvider>
  )
}

function StorySettingsSurface() {
  const router = useRouter()
  const isPhone = useTier() === 'phone'
  const isFocused = useIsFocused()
  const { storyId, tab } = useLocalSearchParams<{ storyId: string; tab?: string }>()
  const session = useStorySettingsSaveSession()

  const [selectedTab, setSelectedTab] = useState<StorySettingsTabId | null>(
    isStorySettingsTabId(tab) ? tab : null,
  )

  // Desktop / tablet always shows a detail pane, so fall back to a default tab;
  // phone is list-first, so no tab is open until one is tapped.
  const activeTab: StorySettingsTabId | null = selectedTab ?? (isPhone ? null : 'about')

  // Only the story-list and reader routes hydrate this store, so a deep link
  // straight here starts empty — the missing-story state has to wait for the
  // read or it flashes over a story that does exist.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    void rehydrateStories(db).then(() => setHydrated(true))
  }, [])
  const storyTitle = storiesStore.useStories((s) => s.rows.find((r) => r.id === storyId)?.title)
  const storyExists = storiesStore.useStories((s) => s.rows.some((r) => r.id === storyId))
  const isGenerating = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some((r) => r.storyId === storyId),
  )

  const leaveSurface = useCallback(() => {
    session.requestLeave(() => router.back())
  }, [session, router])

  // Phone is list-first, so a tab open there collapses back to the list
  // (within-session, unguarded); every other back exits through the dirty guard.
  const handleBack = useCallback(() => {
    if (isPhone && selectedTab != null) setSelectedTab(null)
    else leaveSurface()
  }, [isPhone, selectedTab, leaveSurface])

  // Unconditional: on tablet `isPhone` is false, so returning false here would
  // let Android's default pop the route straight past the dirty guard.
  useMasterDetailBack(true, handleBack)

  const groups = STORY_SETTINGS_TAB_GROUPS.map((group) => ({
    id: group.id,
    header: t(`storySettings:sections.${group.id}`),
    tabs: group.tabs.map((id) => ({ id, label: t(`storySettings:tabs.${id}`) })),
  }))

  const placeholder = (
    <EmptyState title={t('storySettings:landsLater')} subtext={t('storySettings:landsLaterBody')} />
  )
  const missingStory = <EmptyState title={t('storySettings:missingStory')} />

  // C7 seam: consumer slices replace a placeholder branch with their section.
  // Called for every tab, not just the active one — see StorySettingsShell.
  const renderPanel = (_id: StorySettingsTabId) =>
    hydrated && !storyExists ? missingStory : placeholder

  return (
    <ScreenShell
      variant="in-story"
      title={
        <Text className="font-semibold">
          {storyTitle != null
            ? `${storyTitle} / ${t('storySettings:title')}`
            : t('storySettings:title')}
        </Text>
      }
      chapterProgress={0}
      hideSelfReferentialIcon
      onBack={handleBack}
      actions={<AppActionsMenu />}
      statusSlot={
        <GenerationStatusPill
          activePhase={isGenerating ? 'generating-narrative' : undefined}
          onCancel={() => void awaitRunTerminal(PER_TURN_KIND, 'cancel')}
          onErrorTap={() => {}}
        />
      }
    >
      <StorySettingsShell
        groups={groups}
        activeTab={activeTab}
        onSelectTab={setSelectedTab}
        renderPanel={renderPanel}
        saveBar={
          session.snapshot.isDirty ? (
            <SaveBar
              dirtyFields={session.snapshot.dirtyFields}
              dirtyCount={session.snapshot.dirtyCount}
              saving={session.saving}
              onSave={() => void session.save()}
              onDiscard={session.discard}
            />
          ) : null
        }
      />
      <UnsavedChangesDialog
        open={session.pendingLeave && isFocused}
        saving={session.saving}
        onSave={() => session.resolveLeave('save')}
        onDiscard={() => session.resolveLeave('discard')}
        onCancel={() => session.resolveLeave('cancel')}
      />
    </ScreenShell>
  )
}
