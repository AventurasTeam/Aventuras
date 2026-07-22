import { useIsFocused } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { SaveBar } from '@/components/compounds/save-bar'
import { ScreenShell } from '@/components/shells/screen-shell'
import { StorySettingsShell } from '@/components/shells/story-settings-shell'
import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
} from '@/components/story-settings/save-session'
import { UnsavedChangesDialog } from '@/components/story-settings/unsaved-changes-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useTier } from '@/hooks/use-tier'
import { updateStorySettings } from '@/lib/actions'
import { db, runInTransaction, type StorySettings } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { rehydrateStories, storiesStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

// C7 seam: a consumer slice adds its tab here (if new), then renders its
// section in the ternary below. Sections join the save session from inside
// their own body via useStorySettingsSection.
type StorySettingsTabId =
  | 'about'
  | 'generation'
  | 'models'
  | 'memory'
  | 'translation'
  | 'pack'
  | 'calendar'
  | 'advanced'

const STORY_SETTINGS_TAB_IDS = [
  'about',
  'generation',
  'models',
  'memory',
  'translation',
  'pack',
  'calendar',
  'advanced',
] as const satisfies readonly StorySettingsTabId[]

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
  const onSaveFailed = useCallback((error: unknown) => {
    logger.error('action_layer.story_settings_save_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error(t('storySettings:save.failed'))
  }, [])
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

  const initialTab = STORY_SETTINGS_TAB_IDS.includes(tab as StorySettingsTabId)
    ? (tab as StorySettingsTabId)
    : null
  const [selectedTab, setSelectedTab] = useState<StorySettingsTabId | null>(initialTab)

  // Desktop / tablet always shows a detail pane, so fall back to a default tab;
  // phone is list-first, so no tab is open until one is tapped.
  const activeTab: StorySettingsTabId | null = selectedTab ?? (isPhone ? null : 'about')

  // Only the story-list and reader routes hydrate this store, so a deep link
  // straight here would render the breadcrumb without its story title.
  useEffect(() => {
    void rehydrateStories(db)
  }, [])
  const storyTitle = storiesStore.useStories((s) => s.rows.find((r) => r.id === storyId)?.title)

  const leaveSurface = useCallback(() => {
    session.requestLeave(() => router.back())
  }, [session, router])

  // Phone is list-first, so a tab open there collapses back to the list
  // (within-session, unguarded); every other back exits through the dirty guard.
  const handleBack = useCallback(() => {
    if (isPhone && selectedTab != null) setSelectedTab(null)
    else leaveSurface()
  }, [isPhone, selectedTab, leaveSurface])

  // Always intercepts on this surface. Returning false would let Android pop
  // the route without ever consulting the dirty guard.
  useMasterDetailBack(true, handleBack)

  const groups = [
    {
      id: 'story',
      header: t('storySettings:sections.story'),
      tabs: [
        { id: 'about' as const, label: t('storySettings:tabs.about') },
        { id: 'generation' as const, label: t('storySettings:tabs.generation') },
      ],
    },
    {
      id: 'settings',
      header: t('storySettings:sections.settings'),
      tabs: [
        { id: 'models' as const, label: t('storySettings:tabs.models') },
        { id: 'memory' as const, label: t('storySettings:tabs.memory') },
        { id: 'translation' as const, label: t('storySettings:tabs.translation') },
        { id: 'pack' as const, label: t('storySettings:tabs.pack') },
        { id: 'calendar' as const, label: t('storySettings:tabs.calendar') },
        { id: 'advanced' as const, label: t('storySettings:tabs.advanced') },
      ],
    },
  ]

  const placeholder = (
    <EmptyState title={t('storySettings:landsLater')} subtext={t('storySettings:landsLaterBody')} />
  )
  const missingStory = <EmptyState title={t('storySettings:missingStory')} />

  // C7 seam: consumer slices replace a placeholder branch with their section.
  // 3.1b → 'memory' (embedding status). 3.7 → 'generation' (authoring aids).
  // Called for every tab, not just the active one — see StorySettingsShell.
  const renderPanel = (_id: StorySettingsTabId) => (storyId == null ? missingStory : placeholder)

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

export { STORY_SETTINGS_TAB_IDS }
export type { StorySettingsTabId }
