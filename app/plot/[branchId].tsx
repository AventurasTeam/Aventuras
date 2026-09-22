import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/compounds/breadcrumb'
import { ImporterMenu } from '@/components/compounds/importer-menu'
import { StoryStatusPill } from '@/components/compounds/story-status-pill'
import { HappeningDetailPane } from '@/components/plot/happening-detail-pane'
import { plotAddOptions } from '@/components/plot/plot-add-options'
import { PlotDetailEmpty } from '@/components/plot/plot-detail-empty'
import { PlotListPane, type PlotListPaneHandle } from '@/components/plot/plot-list-pane'
import { distinctCategories, happeningLinksFor } from '@/components/plot/plot-route-data'
import {
  deepLinkTab,
  parsePlotSelection,
  plotAddLabel,
  plotKindLabel,
  type PlotSelection,
} from '@/components/plot/plot-selection'
import { ThreadDetailPane } from '@/components/plot/thread-detail-pane'
import { usePlotDeepLink } from '@/components/plot/use-plot-deep-link'
import { usePlotSelection } from '@/components/plot/use-plot-selection'
import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { ScreenShell } from '@/components/shells/screen-shell'
import {
  storySettingsGenerationPhase,
  useStoryGenerationGate,
} from '@/components/story-settings/generation-run'
import { EmptyState } from '@/components/ui/empty-state'
import { KeyboardInsetColumn } from '@/components/ui/keyboard-inset-column'
import { single as singleParam } from '@/components/world/world-selection'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useIsRouteFocused } from '@/hooks/use-is-route-focused'
import { useLeaveFailedStoryOpen } from '@/hooks/use-leave-failed-story-open'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useOpenRegionTokens } from '@/hooks/use-open-region-tokens'
import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import { useRowSignals } from '@/hooks/use-row-signals'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import { useTier } from '@/hooks/use-tier'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { loadOpenStory, saveHappening, saveThread } from '@/lib/actions'
import { db, runInTransaction, type Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import type { HappeningFilter, PlotKind, PlotListSignals, ThreadFilter } from '@/lib/list-modules'
import {
  awaitRunTerminal,
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  rehydrateStories,
  storiesStore,
  threadsStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

export default function PlotRoute() {
  const router = useRouter()
  const surfaceNavigate = useSurfaceNavigate()
  const isPhone = useTier() === 'phone'
  const focused = useIsRouteFocused()
  const params = useLocalSearchParams<{
    branchId?: string | string[]
    kind?: string | string[]
    id?: string | string[]
    tab?: string | string[]
  }>()
  const branchId = singleParam(params.branchId) ?? ''
  // Params seed the initial state only; `tab` opens the linked row's detail on that tab.
  const [initialSelection] = useState(() =>
    parsePlotSelection({ kind: params.kind, id: params.id, tab: params.tab }),
  )
  const [kind, setKind] = useState<PlotKind>(initialSelection?.kind ?? 'thread')
  const [threadFilter, setThreadFilter] = useState<ThreadFilter>('all')
  const [happeningFilter, setHappeningFilter] = useState<HappeningFilter>('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [session, setSession] = useState<RowSessionHandle | null>(null)
  const listRef = useRef<PlotListPaneHandle>(null)
  const leaveFailedOpen = useLeaveFailedStoryOpen()

  // A cold mount (reload, deep link) hydrates the working set the way the reader does.
  useEffect(() => {
    if (branchId === '') {
      leaveFailedOpen()
      return
    }
    if (currentStoryStore.getCurrentStory()?.branchId === branchId) return
    let current = true
    void loadOpenStory(branchId, ctx, () => current)
      .then((result) => {
        if (current && result.status !== 'ok') leaveFailedOpen()
      })
      .catch((err: unknown) => {
        logger.error('app.plot_story_load_failed', {
          branchId,
          error: err instanceof Error ? err.message : String(err),
        })
        if (current) leaveFailedOpen()
      })
    return () => {
      current = false
    }
  }, [branchId, leaveFailedOpen])
  useEffect(() => {
    // Never rejects: internally try/caught, logs bootstrap.stories_hydrate_failed on its own.
    void rehydrateStories(db)
  }, [])

  const open = currentStoryStore.useCurrentStory((o) => (o?.branchId === branchId ? o : null))
  const storyId = open?.storyId ?? null
  const storyTitle = storiesStore.useStories((s) => s.rows.find((r) => r.id === storyId)?.title)

  // Raw maps from the selectors (stable between patches); arrays via useMemo.
  const threadRows = threadsStore.useThreads((m) => m)
  const threads = useMemo(
    () => [...threadRows.values()].filter((r) => r.branchId === branchId),
    [threadRows, branchId],
  )
  const happeningRows = happeningsStore.useHappenings((m) => m)
  const happenings = useMemo(
    () => [...happeningRows.values()].filter((r) => r.branchId === branchId),
    [happeningRows, branchId],
  )
  const threadCategories = useMemo(() => distinctCategories(threads), [threads])
  const happeningCategories = useMemo(() => distinctCategories(happenings), [happenings])
  const involvementRows = happeningInvolvementsStore.useInvolvements((m) => m)
  const awarenessRows = happeningAwarenessStore.useAwareness((m) => m)
  const entityRows = entitiesStore.useEntities((m) => m)
  const entities = useMemo(
    () => [...entityRows.values()].filter((e) => e.branchId === branchId),
    [entityRows, branchId],
  )
  const chapterRows = chaptersStore.useChapters((m) => m)
  // The chapters store holds closed chapters only; the open region has no row.
  const hasClosedChapters = useMemo(
    () => [...chapterRows.values()].some((c) => c.branchId === branchId),
    [chapterRows, branchId],
  )
  const entryIndex = useEntryIndex(branchId)
  const listSignals = useMemo<PlotListSignals>(
    () => ({ entries: entryIndex.index, hasClosedChapters }),
    [entryIndex.index, hasClosedChapters],
  )
  const signals = useRowSignals(branchId)

  const { selectedId, selection, select, startCreate } = usePlotSelection({
    initialId: initialSelection?.id ?? null,
    kind,
    threads,
    happenings,
    ready: open != null,
  })
  const detailOpen = isPhone && selection != null
  // The entry index's `!ready` means not read yet, never dangling: no pane renders against it.
  const panesReady = open != null && entryIndex.ready

  const selectedHappeningId = selection?.type === 'happening' ? selection.row.id : null
  const links = useMemo(
    () => happeningLinksFor(selectedHappeningId, branchId, involvementRows, awarenessRows),
    [selectedHappeningId, branchId, involvementRows, awarenessRows],
  )

  const { activeRunKind, editBlocked, gateReason } = useStoryGenerationGate(storyId ?? undefined)
  const openRegionPct = useOpenRegionTokens(storyId)

  // save-sessions.md → Navigate-away guard: every in-surface transition routes through here.
  const guard = useCallback(
    (proceed: () => void) => {
      if (session == null) proceed()
      else session.requestLeave(proceed)
    },
    [session],
  )
  useUnsavedChangesGuard(session?.dirty ?? false, guard)

  const switchKind = useCallback(
    (next: PlotKind) => {
      setKind(next)
      select(null)
      setThreadFilter('all')
      setHappeningFilter('all')
      setSearch('')
    },
    [select],
  )
  const selectKind = useCallback(
    (next: PlotKind) => guard(() => switchKind(next)),
    [guard, switchKind],
  )
  const selectRow = useCallback(
    (id: string) => {
      // Re-tapping the open row replaces nothing, so it must not raise the dialog.
      if (id === selectedId) return
      guard(() => select(id))
    },
    [selectedId, guard, select],
  )

  // Phone is list-first: an open detail collapses to the list; any other back leaves, and
  // leaving is guarded by useUnsavedChangesGuard, which replays the exact pop.
  const handleBack = useCallback(() => {
    if (detailOpen) guard(() => select(null))
    else router.back()
  }, [detailOpen, guard, router, select])
  // Constant true: every Android back goes through handleBack, so leaving is always the JS pop
  // the guard intercepts.
  useMasterDetailBack(true, handleBack)

  // Story open hydrates every Plot store before it publishes `open`, so a linked row the pane
  // can't find doesn't exist, and its reveal no-ops.
  const revealLink = useCallback((link: PlotSelection) => {
    listRef.current?.revealRow(link.kind, link.id)
  }, [])
  const pendingLink = usePlotDeepLink(initialSelection, panesReady, revealLink)

  // The popover measures its trigger on open, and phone hides the list (and its `[+]`) while
  // a row is selected. Opening the menu alone drops nothing, so only a switch is guarded.
  const openAddMenu = useCallback(
    (target: PlotKind) => {
      if (target === kind && !isPhone) {
        setAddOpen(true)
        return
      }
      guard(() => {
        if (target !== kind) switchKind(target)
        else select(null)
        setAddOpen(true)
      })
    },
    [kind, isPhone, guard, switchKind, select],
  )

  const contextual: ActionGroup = useMemo(
    () => ({
      id: 'plot',
      header: t('chrome.onThisScreen'),
      entries: [
        {
          id: 'add-thread',
          label: t('plot:actions.addThread'),
          disabled: editBlocked,
          disabledReason: gateReason,
          onActivate: () => openAddMenu('thread'),
        },
        {
          id: 'add-happening',
          label: t('plot:actions.addHappening'),
          disabled: editBlocked,
          disabledReason: gateReason,
          onActivate: () => openAddMenu('happening'),
        },
      ],
    }),
    [editBlocked, gateReason, openAddMenu],
  )

  const onSaved = useCallback(
    (id: string) => {
      select(id)
      toast.success(t('plot:save.saved'))
    },
    [select],
  )
  // The save bar's notice is tooltip-only on phone, so a refused save surfaces here too.
  const onRejected = useCallback((text: string) => {
    toast.error(text)
  }, [])
  const openEntity = useCallback(
    (entity: Entity) =>
      guard(() => surfaceNavigate(`/world/${branchId}?kind=${entity.kind}&id=${entity.id}`)),
    [guard, surfaceNavigate, branchId],
  )

  const selectedName =
    selection == null
      ? null
      : selection.type === 'create'
        ? t(selection.kind === 'thread' ? 'plot:detail.newThread' : 'plot:detail.newHappening')
        : selection.row.title

  // Breadcrumb ignores the last segment's onPress, so parents alone navigate.
  const titleSegments: BreadcrumbSegment[] = [
    {
      key: 'story',
      label: storyTitle ?? t('reader:placeholderTitle'),
      onPress: () => guard(() => surfaceNavigate(`/reader-composer/${branchId}`)),
    },
    { key: 'plot', label: t('plot:title'), onPress: () => guard(() => select(null)) },
    ...(detailOpen ? [{ key: 'kind', label: plotKindLabel(kind) }] : []),
  ]
  const subHeaderSegments: BreadcrumbSegment[] = [
    { key: 'kind', label: plotKindLabel(kind), onPress: () => guard(() => select(null)) },
    ...(selectedName != null ? [{ key: 'row', label: selectedName }] : []),
  ]

  const detailPane =
    selection == null ? (
      <PlotDetailEmpty />
    ) : selection.type === 'happening' ||
      (selection.type === 'create' && selection.kind === 'happening') ? (
      <HappeningDetailPane
        row={selection.type === 'happening' ? selection.row : null}
        links={links}
        entities={entities}
        entries={entryIndex.entries}
        categories={happeningCategories}
        recentlyClassified={
          selection.type === 'happening'
            ? signals.recentlyClassified.rows.get(selection.row.id)
            : undefined
        }
        blocked={editBlocked}
        blockedReason={gateReason}
        initialTab={
          selection.type === 'happening'
            ? deepLinkTab(pendingLink, 'happening', selection.row.id)
            : undefined
        }
        onSave={(draft) =>
          saveHappening(
            {
              branchId,
              row: selection.type === 'happening' ? selection.row : null,
              links,
              draft,
            },
            ctx,
          )
        }
        onSaved={onSaved}
        onRejected={onRejected}
        onSession={setSession}
        onOpenEntity={openEntity}
        hotkeysEnabled={focused}
      />
    ) : (
      <ThreadDetailPane
        row={selection.type === 'thread' ? selection.row : null}
        entryIndex={entryIndex.index}
        categories={threadCategories}
        recentlyClassified={
          selection.type === 'thread'
            ? signals.recentlyClassified.rows.get(selection.row.id)
            : undefined
        }
        blocked={editBlocked}
        blockedReason={gateReason}
        initialTab={
          selection.type === 'thread'
            ? deepLinkTab(pendingLink, 'thread', selection.row.id)
            : undefined
        }
        onSave={(draft) =>
          saveThread(
            { branchId, row: selection.type === 'thread' ? selection.row : null, draft },
            ctx,
          )
        }
        onSaved={onSaved}
        onRejected={onRejected}
        onSession={setSession}
        hotkeysEnabled={focused}
      />
    )

  return (
    <ScreenShell
      variant="in-story"
      title={<Breadcrumb segments={titleSegments} />}
      chapterProgress={openRegionPct}
      onBack={handleBack}
      onOpenStorySettings={() => {
        if (storyId != null) guard(() => surfaceNavigate(`/story-settings/${storyId}`))
      }}
      actions={
        <AppActionsMenu
          // The `[+]` isn't mounted before the panes are; an open armed then fires later.
          contextual={panesReady ? contextual : undefined}
          story={storyId != null ? { storyId, branchId, surface: 'plot' } : undefined}
          beforeNavigate={guard}
        />
      }
      statusSlot={
        <StoryStatusPill
          storyId={storyId}
          swapTarget={open?.settings.embedding_swap_target}
          activePhase={
            activeRunKind != null ? storySettingsGenerationPhase(activeRunKind) : undefined
          }
          onCancel={() => {
            if (activeRunKind != null) void awaitRunTerminal(activeRunKind, branchId, 'cancel')
          }}
          onOpenMemory={() => {
            if (storyId != null)
              guard(() => surfaceNavigate(`/story-settings/${storyId}?tab=memory`))
          }}
        />
      }
    >
      {!panesReady ? (
        <View className="flex-1 items-center justify-center">
          {entryIndex.failed ? (
            <EmptyState
              title={t('plot:entryIndexFailed')}
              subtext={t('plot:entryIndexFailedBody')}
            />
          ) : (
            <EmptyState title={t('reader:hydrationLoading')} />
          )}
        </View>
      ) : (
        // touch.md → Save bar on phone: the panes compress so the save bar rides above the IME.
        <KeyboardInsetColumn className="min-h-0">
          <MasterDetailLayout
            isRowSelected={selection != null}
            subHeader={<Breadcrumb segments={subHeaderSegments} testID="plot-sub-header" />}
            listPane={
              <PlotListPane
                ref={listRef}
                kind={kind}
                onKindChange={selectKind}
                threadFilter={threadFilter}
                onThreadFilterChange={setThreadFilter}
                happeningFilter={happeningFilter}
                onHappeningFilterChange={setHappeningFilter}
                search={search}
                onSearchChange={setSearch}
                threads={threads}
                happenings={happenings}
                listSignals={listSignals}
                selectedId={selectedId}
                onSelect={selectRow}
                recentlyClassified={signals.recentlyClassified.rows}
                addSlot={
                  <ImporterMenu
                    trigger="icon"
                    label={plotAddLabel(kind)}
                    options={plotAddOptions(() => guard(startCreate), {
                      disabled: editBlocked,
                      disabledReason: gateReason,
                    })}
                    open={addOpen}
                    onOpenChange={setAddOpen}
                  />
                }
              />
            }
            detailPane={detailPane}
          />
        </KeyboardInsetColumn>
      )}
    </ScreenShell>
  )
}
