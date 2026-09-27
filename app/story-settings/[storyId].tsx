import {
  useIsFocused,
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/compounds/breadcrumb'
import { StoryStatusPill } from '@/components/compounds/story-status-pill'
import { ScreenShell } from '@/components/shells/screen-shell'
import { StorySettingsShell } from '@/components/shells/story-settings-shell'
import { AboutPanel } from '@/components/story-settings/about-panel'
import { AuthoringAidsPanel } from '@/components/story-settings/authoring-aids-panel'
import { storyPillPhase, useStoryGenerationGate } from '@/components/story-settings/generation-run'
import { MemoryKnobsPanel } from '@/components/story-settings/memory-knobs-panel'
import { MemoryPanel } from '@/components/story-settings/memory-panel'
import { ModelsPanel } from '@/components/story-settings/models-panel'
import {
  storySettingsPanelData,
  type StorySettingsPanelData,
} from '@/components/story-settings/panel-data'
import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
} from '@/components/story-settings/save-session'
import {
  StorySettingsDialogs,
  StorySettingsSaveBar,
} from '@/components/story-settings/save-session-chrome'
import {
  STORY_SETTINGS_TAB_GROUPS,
  STORY_SETTINGS_TAB_IDS,
  syncTabParam,
  type StorySettingsTabId,
} from '@/components/story-settings/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useOpenRegionTokens } from '@/hooks/use-open-region-tokens'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import { useTier } from '@/hooks/use-tier'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import {
  saveStorySettingsSession,
  storyHasTurns,
  StorySettingsStaleStoreError,
  StorySettingsUnreadableError,
  type StorySettingsSessionPatch,
} from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import {
  awaitRunTerminal,
  generationStore,
  isBackgroundKind,
  rehydrateStories,
  storiesStore,
} from '@/lib/stores'
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
    async (patch: StorySettingsSessionPatch) => {
      if (storyId == null) return Promise.reject(new Error('Story not found'))
      const result = await saveStorySettingsSession(storyId, patch, ctx)
      if (result.status === 'rejected') throw new Error(result.reason)
      return result.settings
    },
    [storyId],
  )
  const onSaved = useCallback(() => toast.success(t('storySettings:save.saved')), [])
  const onSaveFailed = useCallback(
    (error: unknown) => {
      // Both of these mean the write landed — telling the user it failed would send
      // them to re-enter values that are already persisted, on every retry.
      const stale = error instanceof StorySettingsStaleStoreError
      const unreadable = error instanceof StorySettingsUnreadableError
      logger.error('action_layer.story_settings_save_failed', {
        storyId,
        stale,
        unreadable,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error(
        stale
          ? t('storySettings:save.stale')
          : unreadable
            ? t('storySettings:save.unreadable')
            : t('storySettings:save.failed'),
      )
    },
    [storyId],
  )
  // Re-read on every focus: a reader pushed over this screen can add turns.
  // Fails closed while pending, blurred, or failed — an unneeded confirm costs
  // a click, a skipped one costs consent.
  const [hasTurns, setHasTurns] = useState(true)
  useFocusEffect(
    useCallback(() => {
      if (storyId == null) return undefined
      let cancelled = false
      void storyHasTurns(storyId, db)
        .then((value) => {
          if (!cancelled) setHasTurns(value)
        })
        .catch((error: unknown) => {
          if (!cancelled) setHasTurns(true)
          logger.error('action_layer.story_has_turns_failed', {
            storyId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      return () => {
        cancelled = true
        setHasTurns(true)
      }
    }, [storyId]),
  )
  return (
    <StorySettingsSaveSessionProvider
      onCommit={onCommit}
      onSaved={onSaved}
      onSaveFailed={onSaveFailed}
      confirmFlagged={hasTurns}
    >
      <StorySettingsSurface storyId={storyId} />
    </StorySettingsSaveSessionProvider>
  )
}

function StorySettingsSurface({ storyId }: { storyId: string | undefined }) {
  const router = useRouter()
  const navigation = useNavigation<NavigationProp<ParamListBase>>()
  const surfaceNavigate = useSurfaceNavigate()
  const isPhone = useTier() === 'phone'
  const isFocused = useIsFocused()
  const params = useLocalSearchParams<{ tab?: string | string[] }>()
  const tab = singleParam(params.tab)
  const session = useStorySettingsSaveSession()

  // A navigation here with `?tab=` reuses this mounted screen, so the selection
  // follows the param as it changes, not just at mount.
  const [tabState, setTabState] = useState(() =>
    syncTabParam({ selected: null, param: undefined }, tab),
  )
  const syncedTabState = syncTabParam(tabState, tab)
  if (syncedTabState !== tabState) setTabState(syncedTabState)
  const selectedTab = syncedTabState.selected

  // Every selection writes the param back, so it only changes on a navigation here.
  // `navigation.setParams`, not `router.setParams`: this handle is bound to this
  // route, where the global router targets whichever one is focused.
  const selectTab = useCallback(
    (id: StorySettingsTabId | null) => {
      setTabState((prev) => ({ ...prev, selected: id }))
      navigation.setParams({ tab: id ?? undefined })
    },
    [navigation],
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
  // The route owns the source: `currentStoryStore` is null on any cold entry
  // here, and `saveStorySettingsSession` rehydrates this store, so a saved
  // section re-derives from the fresh row.
  const row = storiesStore.useStories((s) => s.rows.find((r) => r.id === storyId))
  const panelData = useMemo(
    () => storySettingsPanelData(storyId, hydration, row),
    [storyId, hydration, row],
  )
  const settings = panelData.status === 'ready' ? panelData.settings : null
  const currentBranchId = row?.currentBranchId ?? null
  const {
    activeRunKind,
    editBlocked,
    gateReason: disabledReason,
    classifierRunning,
  } = useStoryGenerationGate(storyId)
  // awaitRunTerminal is branch-scoped, and this screen has no branch param. Any
  // cancellable run for this story carries it: runs only exist for the open
  // story/branch.
  const cancelBranchId = generationStore.useGeneration(
    (s) =>
      [...s.txState.runs.values()].find((r) => r.storyId === storyId && !isBackgroundKind(r.kind))
        ?.branchId ?? null,
  )

  // Scoped to THIS route's story: the open story survives navigation, so an
  // unscoped read would show whichever story the session last opened in the
  // reader against that story's threshold.
  const openRegionPct = useOpenRegionTokens(storyId)

  const isDirty = session.snapshot.dirtyFields.length > 0
  useUnsavedChangesGuard(isDirty, session.requestLeave)

  const leaveSurface = useCallback(() => router.back(), [router])

  // Phone is list-first, so a tab open there collapses back to the list
  // (within-session, unguarded); every other back exits through the dirty guard.
  const handleBack = useCallback(() => {
    if (isPhone && selectedTab != null) selectTab(null)
    else leaveSurface()
  }, [isPhone, selectedTab, selectTab, leaveSurface])

  // Constant true on every tier: any false here falls through to Android's
  // route-pop, which never sees the dirty guard.
  useMasterDetailBack(true, handleBack)

  const groups = STORY_SETTINGS_TAB_GROUPS.map((group) => ({
    id: group.id,
    header: t(`storySettings:groups.${group.id}`),
    tabs: group.tabs.map((id) => ({ id, label: t(`storySettings:tabs.${id}`) })),
  }))

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
      case 'corrupt':
        return (
          <EmptyState title={t('storySettings:corrupt')} subtext={t('storySettings:corruptBody')} />
        )
      case 'ready':
        if (id === 'about')
          return (
            <AboutPanel
              story={data.story}
              definition={data.definition}
              disabled={editBlocked}
              disabledReason={disabledReason}
            />
          )
        if (id === 'generation')
          return (
            <AuthoringAidsPanel
              settings={data.settings}
              definition={data.definition}
              disabled={editBlocked}
              disabledReason={disabledReason}
            />
          )
        if (id === 'models')
          return (
            <ModelsPanel
              settings={data.settings}
              disabled={editBlocked}
              disabledReason={disabledReason}
            />
          )
        if (id === 'memory' && storyId != null)
          return (
            <MemoryKnobsPanel
              settings={data.settings}
              disabled={editBlocked}
              disabledReason={disabledReason}
              embedder={
                <MemoryPanel
                  storyId={storyId}
                  settings={data.settings}
                  disabled={editBlocked}
                  disabledReason={disabledReason}
                />
              }
            />
          )
        return (
          <EmptyState
            title={t('storySettings:landsLater')}
            subtext={t('storySettings:landsLaterBody')}
          />
        )
    }
  }

  const titleSegments: BreadcrumbSegment[] = [
    // Leaves the surface, so it goes through the dirty guard like ←; pops to a
    // reader below, pushes one when none is.
    ...(row != null
      ? [
          {
            key: 'story',
            label: row.title,
            onPress:
              currentBranchId != null
                ? () =>
                    session.requestLeave(() =>
                      surfaceNavigate(`/reader-composer/${currentBranchId}`),
                    )
                : undefined,
          },
        ]
      : []),
    {
      key: 'settings',
      label: t('storySettings:title'),
      onPress: isPhone && selectedTab != null ? () => selectTab(null) : undefined,
    },
    ...(isPhone && selectedTab != null
      ? [{ key: 'tab', label: t(`storySettings:tabs.${selectedTab}`) }]
      : []),
  ]

  return (
    <ScreenShell
      variant="in-story"
      title={<Breadcrumb segments={titleSegments} testID="story-settings-breadcrumb" />}
      chapterProgress={openRegionPct}
      hideSelfReferentialIcon
      onBack={handleBack}
      actions={
        <AppActionsMenu
          story={
            storyId != null && currentBranchId != null
              ? { storyId, branchId: currentBranchId, surface: 'story-settings' }
              : undefined
          }
          beforeNavigate={session.requestLeave}
          blocked={session.pendingLeave || session.pendingConfirmation}
        />
      }
      statusSlot={
        <StoryStatusPill
          storyId={storyId ?? null}
          swapTarget={settings?.embedding_swap_target}
          activePhase={storyPillPhase(activeRunKind, classifierRunning)}
          onCancel={() => {
            if (activeRunKind != null && cancelBranchId != null) {
              void awaitRunTerminal(activeRunKind, cancelBranchId, 'cancel')
            }
          }}
          onOpenMemory={() => selectTab('memory')}
        />
      }
    >
      <StorySettingsShell
        groups={groups}
        activeTab={activeTab}
        onSelectTab={selectTab}
        panelData={panelData}
        renderPanel={renderPanel}
        saveBar={
          <StorySettingsSaveBar
            enabled={isFocused}
            blocked={editBlocked}
            disabledReason={disabledReason}
          />
        }
      />
      <StorySettingsDialogs blocked={editBlocked} disabledReason={disabledReason} />
    </ScreenShell>
  )
}
