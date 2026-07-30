import { useIsFocused } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState, type ReactElement } from 'react'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { SaveBar } from '@/components/compounds/save-bar'
import { ScreenShell } from '@/components/shells/screen-shell'
import { StorySettingsShell } from '@/components/shells/story-settings-shell'
import { MemoryPanel } from '@/components/story-settings/memory-panel'
import { type StorySettingsPanelData } from '@/components/story-settings/panel-data'
import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
} from '@/components/story-settings/save-session'
import {
  isStorySettingsTabId,
  STORY_SETTINGS_TAB_GROUPS,
  STORY_SETTINGS_TAB_IDS,
  type StorySettingsTabId,
} from '@/components/story-settings/tabs'
import { UnsavedChangesDialog } from '@/components/story-settings/unsaved-changes-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useTier } from '@/hooks/use-tier'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { StorySettingsStaleStoreError, updateStorySettings } from '@/lib/actions'
import { db, runInTransaction, type StorySettings } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { awaitRunTerminal, PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import { generationStore, rehydrateStories, storiesStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

// expo-router types params as strings but hands back `string[]` for a repeated
// query param.
function singleParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export default function StorySettingsRoute() {
  const params = useLocalSearchParams<{ storyId?: string | string[] }>()
  const storyId = singleParam(params.storyId)
  // All three are in the provider's `save` dep chain; inline arrows would give
  // every consumer a new context identity on each render.
  const onCommit = useCallback(
    (patch: Partial<StorySettings>) => {
      if (storyId == null) return Promise.reject(new Error('Story not found'))
      return updateStorySettings(storyId, patch, ctx)
    },
    [storyId],
  )
  const onSaved = useCallback(() => toast.success(t('storySettings:save.saved')), [])
  const onSaveFailed = useCallback(
    (error: unknown) => {
      // A stale store means the write landed — telling the user it failed would
      // send them to re-enter values that are already persisted.
      const stale = error instanceof StorySettingsStaleStoreError
      logger.error('action_layer.story_settings_save_failed', {
        storyId,
        stale,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error(stale ? t('storySettings:save.stale') : t('storySettings:save.failed'))
    },
    [storyId],
  )
  return (
    <StorySettingsSaveSessionProvider
      onCommit={onCommit}
      onSaved={onSaved}
      onSaveFailed={onSaveFailed}
    >
      <StorySettingsSurface storyId={storyId} />
    </StorySettingsSaveSessionProvider>
  )
}

function StorySettingsSurface({ storyId }: { storyId: string | undefined }) {
  const router = useRouter()
  const isPhone = useTier() === 'phone'
  const isFocused = useIsFocused()
  const params = useLocalSearchParams<{ tab?: string | string[] }>()
  const tab = singleParam(params.tab)
  const session = useStorySettingsSaveSession()

  const [selectedTab, setSelectedTab] = useState<StorySettingsTabId | null>(
    isStorySettingsTabId(tab) ? tab : null,
  )

  // Desktop / tablet always shows a detail pane, so fall back to the first rail
  // entry; phone is list-first, so no tab is open until one is tapped.
  const activeTab: StorySettingsTabId | null =
    selectedTab ?? (isPhone ? null : (STORY_SETTINGS_TAB_IDS[0] ?? null))

  // Only routes that open or list a story hydrate this store, so a deep link
  // straight here starts empty — the missing-story state has to wait for the
  // read or it flashes over a story that does exist.
  // rehydrateStories swallows its own read failures and reports them in its
  // return value, so a failed read has to be tracked apart from an empty one —
  // otherwise it renders as "this story is gone".
  const [hydration, setHydration] = useState<'pending' | 'ok' | 'failed'>('pending')
  useEffect(() => {
    void rehydrateStories(db).then((ok) => setHydration(ok ? 'ok' : 'failed'))
  }, [])
  const storyTitle = storiesStore.useStories((s) => s.rows.find((r) => r.id === storyId)?.title)
  const storyExists = storiesStore.useStories((s) => s.rows.some((r) => r.id === storyId))
  // The route owns the source: `currentStoryStore` is null on any cold entry
  // here, and `updateStorySettings` rehydrates this store, so a saved section
  // re-derives from the fresh row.
  const settings = storiesStore.useStories(
    (s) => s.rows.find((r) => r.id === storyId)?.settings ?? null,
  )
  // Split by kind so the pill names what is actually running: a refresh started
  // in the reader stays cancellable after a jump here.
  const isGenerating = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some(
      (r) => r.storyId === storyId && r.kind !== SUGGESTION_REFRESH_KIND,
    ),
  )
  const refreshingSuggestions = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some(
      (r) => r.storyId === storyId && r.kind === SUGGESTION_REFRESH_KIND,
    ),
  )

  const isDirty = session.snapshot.dirtyFields.length > 0
  useUnsavedChangesGuard(isDirty, session.requestLeave)

  const leaveSurface = useCallback(() => {
    session.requestLeave(() => router.back())
  }, [session, router])

  // Phone is list-first, so a tab open there collapses back to the list
  // (within-session, unguarded); every other back exits through the dirty guard.
  const handleBack = useCallback(() => {
    if (isPhone && selectedTab != null) setSelectedTab(null)
    else leaveSurface()
  }, [isPhone, selectedTab, leaveSurface])

  // Constant true on every tier: any false here falls through to Android's
  // route-pop, which never sees the dirty guard.
  useMasterDetailBack(true, handleBack)

  const groups = STORY_SETTINGS_TAB_GROUPS.map((group) => ({
    id: group.id,
    header: t(`storySettings:groups.${group.id}`),
    tabs: group.tabs.map((id) => ({ id, label: t(`storySettings:tabs.${id}`) })),
  }))

  const panelData: StorySettingsPanelData =
    storyId == null
      ? { status: 'missing' }
      : hydration === 'pending'
        ? { status: 'loading' }
        : hydration === 'failed'
          ? { status: 'unavailable' }
          : !storyExists
            ? { status: 'missing' }
            : settings == null
              ? { status: 'uninitialized' }
              : { status: 'ready', settings }

  // Consumer slices switch on `id` here and render their section for the
  // `ready` branch, deriving its draft from `data.settings`.
  const renderPanel = (id: StorySettingsTabId, data: StorySettingsPanelData): ReactElement => {
    switch (data.status) {
      case 'loading':
        return <EmptyState title={t('storySettings:loading')} />
      case 'unavailable':
        return (
          <EmptyState
            title={t('storySettings:unavailable')}
            subtext={t('storySettings:unavailableBody')}
          />
        )
      case 'missing':
        return <EmptyState title={t('storySettings:missingStory')} />
      case 'uninitialized':
        return (
          <EmptyState
            title={t('storySettings:uninitialized')}
            subtext={t('storySettings:uninitializedBody')}
          />
        )
      case 'ready':
        if (id === 'memory' && storyId != null)
          return <MemoryPanel storyId={storyId} settings={data.settings} />
        return (
          <EmptyState
            title={t('storySettings:landsLater')}
            subtext={t('storySettings:landsLaterBody')}
          />
        )
    }
  }

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
          activePhase={
            isGenerating
              ? 'generating-narrative'
              : refreshingSuggestions
                ? 'refreshing-suggestions'
                : undefined
          }
          onCancel={() =>
            void awaitRunTerminal(isGenerating ? PER_TURN_KIND : SUGGESTION_REFRESH_KIND, 'cancel')
          }
          onErrorTap={() => {}}
        />
      }
    >
      <StorySettingsShell
        groups={groups}
        activeTab={activeTab}
        onSelectTab={setSelectedTab}
        panelData={panelData}
        renderPanel={renderPanel}
        saveBar={
          isDirty ? (
            <SaveBar
              dirtyFields={session.snapshot.dirtyFields}
              dirtyCount={session.snapshot.dirtyFields.length}
              saving={session.saving}
              enabled={isFocused}
              onSave={() => void session.save()}
              onDiscard={session.discard}
            />
          ) : null
        }
      />
      {/* No focus gate: `pendingLeave` is only set by this screen's own back
          arrow or the window-close guard, and a pushed-under screen's back
          arrow can't fire — so a pending leave while unfocused means the user
          is closing the window, which is exactly when the dialog must show.
          Gating it there held the close open with nothing on screen to answer
          it, leaving the window unclosable. */}
      <UnsavedChangesDialog
        open={session.pendingLeave}
        saving={session.saving}
        onSave={() => session.resolveLeave('save')}
        onDiscard={() => session.resolveLeave('discard')}
        onCancel={() => session.resolveLeave('cancel')}
      />
    </ScreenShell>
  )
}
