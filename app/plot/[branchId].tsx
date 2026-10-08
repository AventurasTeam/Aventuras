import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/compounds/breadcrumb'
import { DeleteConfirmDialog } from '@/components/compounds/delete-confirm-dialog'
import { ImportDialog } from '@/components/compounds/import-dialog'
import { ImporterMenu } from '@/components/compounds/importer-menu'
import { StoryStatusPill } from '@/components/compounds/story-status-pill'
import { HappeningDetailPane } from '@/components/plot/happening-detail-pane'
import { plotAddOptions } from '@/components/plot/plot-add-options'
import { importFailureText, importRejectionText } from '@/components/plot/plot-copy'
import { PlotDetailEmpty } from '@/components/plot/plot-detail-empty'
import { happeningImportDialog, threadImportDialog } from '@/components/plot/plot-import'
import { PlotListPane, type PlotListPaneHandle } from '@/components/plot/plot-list-pane'
import { distinctCategories, happeningLinksFor } from '@/components/plot/plot-route-data'
import {
  happeningLinkTab,
  parsePlotSelection,
  plotAddLabel,
  plotKindLabel,
  threadLinkTab,
  type PlotSelection,
} from '@/components/plot/plot-selection'
import { ThreadDetailPane } from '@/components/plot/thread-detail-pane'
import { usePlotDelete } from '@/components/plot/use-plot-delete'
import { usePlotSelection } from '@/components/plot/use-plot-selection'
import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { ScreenShell } from '@/components/shells/screen-shell'
import {
  cancelStoryPillRun,
  storyPillPhase,
  useStoryGenerationGate,
} from '@/components/story-settings/generation-run'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { KeyboardInsetColumn } from '@/components/ui/keyboard-inset-column'
import { Text } from '@/components/ui/text'
import { single as singleParam, worldHref } from '@/components/world/world-selection'
import { useColdOpenStory } from '@/hooks/use-cold-open-story'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useIsRouteFocused } from '@/hooks/use-is-route-focused'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useOpenRegionTokens } from '@/hooks/use-open-region-tokens'
import { useRouteLink } from '@/hooks/use-route-link'
import { useRowImport } from '@/hooks/use-row-import'
import { useRowSessionGuard } from '@/hooks/use-row-session-guard'
import { useRowSignals } from '@/hooks/use-row-signals'
import { useTier } from '@/hooks/use-tier'
import {
  importHappening,
  importThread,
  saveHappening,
  saveThread,
  type RowSaveRejectionCode,
} from '@/lib/actions'
import type { HappeningImport, ThreadImport } from '@/lib/avts'
import { db, runInTransaction, type Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import type { HappeningFilter, PlotKind, PlotListSignals, ThreadFilter } from '@/lib/list-modules'
import {
  chaptersStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  storiesStore,
  threadsStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

export default function PlotRoute() {
  const router = useRouter()
  const isPhone = useTier() === 'phone'
  const focused = useIsRouteFocused()
  const params = useLocalSearchParams<{
    branchId?: string | string[]
    kind?: string | string[]
    id?: string | string[]
    tab?: string | string[]
  }>()
  const branchId = singleParam(params.branchId) ?? ''
  const linkKind = singleParam(params.kind)
  const linkId = singleParam(params.id)
  const linkTab = singleParam(params.tab)
  const link = useMemo(
    () => parsePlotSelection({ kind: linkKind, id: linkId, tab: linkTab }),
    [linkKind, linkId, linkTab],
  )
  // The link seeds the initial state, and `tab` opens its row's detail on that tab; one set on
  // this mounted screen later is followed below.
  const [initialSelection] = useState(link)
  const [kind, setKind] = useState<PlotKind>(initialSelection?.kind ?? 'thread')
  const [threadFilter, setThreadFilter] = useState<ThreadFilter>('all')
  const [happeningFilter, setHappeningFilter] = useState<HappeningFilter>('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const listRef = useRef<PlotListPaneHandle>(null)

  const open = useColdOpenStory(branchId, 'plot')
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

  const { activeRunKind, editBlocked, gateReason, classifierRunning } = useStoryGenerationGate(
    storyId ?? undefined,
    branchId,
  )
  const openRegionPct = useOpenRegionTokens(storyId)

  const { onSession, guard, navigateGuarded } = useRowSessionGuard()
  const plotDelete = usePlotDelete(branchId, ctx, guard)
  const cancelDelete = plotDelete.cancel
  // A pending confirm's counts go stale off-screen (another surface can delete/rename the row).
  useEffect(() => {
    if (!focused) cancelDelete()
  }, [focused, cancelDelete])

  // The dialog has closed itself by now; a draft dirtied since resolves through the leave guard.
  const onImported = useCallback(
    (id: string) => {
      guard(() => select(id))
      toast.success(t('plot:import.imported'))
    },
    [guard, select],
  )
  const onImportRejected = useCallback(
    (code: RowSaveRejectionCode) => toast.error(importRejectionText(code)),
    [],
  )
  const onImportFailed = useCallback(
    (error: unknown) => {
      logger.error('app.plot_import_failed', {
        branchId,
        kind,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error(importFailureText())
    },
    [branchId, kind],
  )
  const commitThread = useCallback(
    (payload: ThreadImport) => importThread(branchId, payload, ctx),
    [branchId],
  )
  const commitHappening = useCallback(
    (payload: HappeningImport) => importHappening(branchId, payload, ctx),
    [branchId],
  )
  const threadImport = useRowImport<ThreadImport>({
    blocked: editBlocked,
    guard,
    commit: commitThread,
    onImported,
    onRejected: onImportRejected,
    onFailed: onImportFailed,
  })
  const happeningImport = useRowImport<HappeningImport>({
    blocked: editBlocked,
    guard,
    commit: commitHappening,
    onImported,
    onRejected: onImportRejected,
    onFailed: onImportFailed,
  })
  const activeImport = kind === 'thread' ? threadImport : happeningImport
  const setThreadImportOpen = threadImport.onOpenChange
  const setHappeningImportOpen = happeningImport.onOpenChange
  const closeImports = useCallback(() => {
    setThreadImportOpen(false)
    setHappeningImportOpen(false)
  }, [setThreadImportOpen, setHappeningImportOpen])
  // The dialog is portaled: left open, it would paint over the screen pushed on top.
  useEffect(() => {
    if (!focused) closeImports()
  }, [focused, closeImports])

  const switchKind = useCallback(
    (next: PlotKind) => {
      closeImports()
      setKind(next)
      select(null)
      setThreadFilter('all')
      setHappeningFilter('all')
      setSearch('')
    },
    [select, closeImports],
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
  // useUnsavedChangesGuard holds the pop behind the dialog while dirty.
  const handleBack = useCallback(() => {
    if (detailOpen) guard(() => select(null))
    else router.back()
  }, [detailOpen, guard, router, select])
  // Constant true: Android back always runs handleBack, so it can't leave the app past a dirty
  // pane. Bottom-of-stack Back is inert (parked.md → "Back on a screen entered without the
  // story list beneath it").
  useMasterDetailBack(true, handleBack)

  // Story open hydrates every Plot store before it publishes `open`, so a linked row the pane
  // can't find doesn't exist, and its reveal no-ops.
  const revealLink = useCallback((link: PlotSelection) => {
    listRef.current?.revealRow(link.kind, link.id)
  }, [])
  // A link set on this mounted screen (useSurfaceNavigate reuses it) selects its row, and
  // remounts the pane so it opens on the link's tab.
  const [linkMount, setLinkMount] = useState(0)
  const followLink = useCallback(
    (target: PlotSelection, atMount: boolean) => {
      if (atMount) {
        revealLink(target)
        return
      }
      guard(() => {
        if (target.kind !== kind) switchKind(target.kind)
        select(target.id)
        setLinkMount((n) => n + 1)
        revealLink(target)
      })
    },
    [kind, guard, switchKind, select, revealLink],
  )
  const pendingLink = useRouteLink(link, panesReady, followLink)

  // The popover measures its trigger on open, and phone hides the list (and its `[+]`) while
  // a row is selected. Opening the menu alone drops nothing, so only a kind switch, or phone's
  // deselect, is guarded.
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
  // The save bar's notice is an icon with no visible text, so a refused save also toasts.
  const onRejected = toast.error
  const openEntity = useCallback(
    (entity: Entity) =>
      navigateGuarded(worldHref(branchId, { category: entity.kind, id: entity.id })),
    [navigateGuarded, branchId],
  )

  const selectedName =
    selection == null
      ? null
      : selection.type === 'create'
        ? t(selection.kind === 'thread' ? 'plot:detail.newThread' : 'plot:detail.newHappening')
        : selection.row.title

  // principles.md → Master-detail sub-header: the top bar stays screen-level on every tier.
  const titleSegments: BreadcrumbSegment[] = [
    {
      key: 'story',
      label: storyTitle ?? t('reader:placeholderTitle'),
      onPress: () => navigateGuarded(`/reader-composer/${branchId}`),
    },
    { key: 'plot', label: t('plot:title') },
  ]
  // Breadcrumb ignores the last segment's onPress: `kind` navigates only while a row follows it.
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
        key={linkMount}
        row={selection.type === 'happening' ? selection.row : null}
        createSeq={selection.type === 'create' ? selection.seq : undefined}
        branchId={branchId}
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
            ? happeningLinkTab(pendingLink, selection.row.id)
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
        onSession={onSession}
        onOpenEntity={openEntity}
        onDelete={(row) => plotDelete.request({ kind: 'happening', row })}
        hotkeysEnabled={focused}
      />
    ) : (
      <ThreadDetailPane
        key={linkMount}
        row={selection.type === 'thread' ? selection.row : null}
        createSeq={selection.type === 'create' ? selection.seq : undefined}
        branchId={branchId}
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
          selection.type === 'thread' ? threadLinkTab(pendingLink, selection.row.id) : undefined
        }
        onSave={(draft) =>
          saveThread(
            { branchId, row: selection.type === 'thread' ? selection.row : null, draft },
            ctx,
          )
        }
        onSaved={onSaved}
        onRejected={onRejected}
        onSession={onSession}
        onDelete={(row) => plotDelete.request({ kind: 'thread', row })}
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
        if (storyId != null) navigateGuarded(`/story-settings/${storyId}`)
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
          activePhase={storyPillPhase(activeRunKind, classifierRunning)}
          onCancel={() => cancelStoryPillRun(storyId ?? undefined)}
          onOpenMemory={() => {
            if (storyId != null) navigateGuarded(`/story-settings/${storyId}?tab=memory`)
          }}
        />
      }
    >
      {!panesReady ? (
        <View className="flex-1 items-center justify-center">
          {entryIndex.failed ? (
            <View className="items-center gap-3">
              <EmptyState
                title={t('plot:entryIndexFailed')}
                subtext={t('plot:entryIndexFailedBody')}
              />
              <Button variant="secondary" onPress={entryIndex.retry}>
                <Text>{t('plot:entryIndexRetry')}</Text>
              </Button>
            </View>
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
                    options={plotAddOptions(
                      { onBlank: () => guard(startCreate), onJson: activeImport.request },
                      { disabled: editBlocked, disabledReason: gateReason },
                    )}
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
      {plotDelete.copy != null ? (
        <DeleteConfirmDialog
          open={focused}
          onOpenChange={(next) => {
            if (!next) plotDelete.cancel()
          }}
          {...plotDelete.copy}
          onConfirm={plotDelete.confirm}
        />
      ) : null}
      {kind === 'thread' ? (
        <ImportDialog<ThreadImport>
          {...threadImportDialog()}
          open={threadImport.open && focused}
          onOpenChange={threadImport.onOpenChange}
          onValidated={threadImport.onValidated}
        />
      ) : (
        <ImportDialog<HappeningImport>
          {...happeningImportDialog()}
          open={happeningImport.open && focused}
          onOpenChange={happeningImport.onOpenChange}
          onValidated={happeningImport.onValidated}
        />
      )}
    </ScreenShell>
  )
}
