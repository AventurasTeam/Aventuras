import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/compounds/breadcrumb'
import { CollisionResolveDialog } from '@/components/compounds/collision-resolve-dialog'
import { DeleteConfirmDialog } from '@/components/compounds/delete-confirm-dialog'
import { ImportDialog } from '@/components/compounds/import-dialog'
import { ImporterMenu } from '@/components/compounds/importer-menu'
import { StoryStatusPill } from '@/components/compounds/story-status-pill'
import { distinctCategories } from '@/components/plot/plot-route-data'
import { plotHref } from '@/components/plot/plot-selection'
import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { ScreenShell } from '@/components/shells/screen-shell'
import {
  cancelStoryPillRun,
  storyPillPhase,
  useStoryGenerationGate,
} from '@/components/story-settings/generation-run'
import { EmptyState } from '@/components/ui/empty-state'
import { KeyboardInsetColumn } from '@/components/ui/keyboard-inset-column'
import { CollisionReviewPill } from '@/components/world/collision-review-pill'
import { deriveCollisions } from '@/components/world/collisions'
import { EntityDetailPane } from '@/components/world/detail/entity-detail-pane'
import type { EntityPaneData } from '@/components/world/detail/entity-pane-props'
import { entityTabOf } from '@/components/world/detail/entity-tabs'
import { LoreDetailPane } from '@/components/world/detail/lore-detail-pane'
import { firstFlaggedRow } from '@/components/world/first-flagged-row'
import { useCollisionGate } from '@/components/world/use-collision-gate'
import { collisionResolveProp, useCollisionResolve } from '@/components/world/use-collision-resolve'
import { useWorldDelete } from '@/components/world/use-world-delete'
import {
  useWorldSelection,
  type WorldDetailSelection,
} from '@/components/world/use-world-selection'
import { worldAddOptions } from '@/components/world/world-add-options'
import {
  leadRejectionText,
  importFailureText,
  importRejectionText,
} from '@/components/world/world-copy'
import { WorldDetailPlaceholder } from '@/components/world/world-detail-placeholder'
import { entityImportDialog, loreImportDialog } from '@/components/world/world-import'
import { WorldListPane, type WorldListPaneHandle } from '@/components/world/world-list-pane'
import { involvementsFor, relationshipLinksFor } from '@/components/world/world-route-data'
import {
  parseWorldSelection,
  single as singleParam,
  worldAddLabel,
  worldCategoryLabel,
  type WorldSelection,
} from '@/components/world/world-selection'
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
  importEntity,
  importLore,
  saveEntity,
  saveLore,
  setStoryLead,
  type ImportRejectionCode,
} from '@/lib/actions'
import type { EntityImport, LoreImport } from '@/lib/avts'
import { DEFAULT_CALENDAR_ID, resolveCalendar } from '@/lib/calendar'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { isEntityCategory, type EntityFilter, type WorldCategory } from '@/lib/list-modules'
import {
  characterRelationshipsStore,
  entitiesStore,
  entriesStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  storiesStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'
import { branchWorldTime, resolveLead, type EntitySaveInput, type LoreDraft } from '@/lib/world'

const ctx = { db, runInTransaction }

function selectionName(selection: WorldDetailSelection | null): string | null {
  if (selection == null) return null
  switch (selection.type) {
    case 'create':
      return t(`world:detail.newEntity.${selection.kind}`)
    case 'create-lore':
      return t('world:detail.newLore')
    case 'lore':
      return selection.row.title
    case 'entity':
      return selection.row.name
  }
}

export default function WorldRoute() {
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
    () => parseWorldSelection({ kind: linkKind, id: linkId, tab: linkTab }),
    [linkKind, linkId, linkTab],
  )
  // The link seeds the initial state; one set on this mounted screen later is followed below.
  const [initialSelection] = useState(link)
  const [category, setCategory] = useState<WorldCategory>(initialSelection?.category ?? 'character')
  const [filter, setFilter] = useState<EntityFilter>('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const listRef = useRef<WorldListPaneHandle>(null)

  const open = useColdOpenStory(branchId, 'world')
  const storyId = open?.storyId ?? null
  const storyTitle = storiesStore.useStories((s) => s.rows.find((r) => r.id === storyId)?.title)

  // Raw maps from the selectors (stable between patches); arrays via useMemo.
  const entityRows = entitiesStore.useEntities((m) => m)
  const entities = useMemo(
    () => [...entityRows.values()].filter((e) => e.branchId === branchId),
    [entityRows, branchId],
  )
  const loreRows = loreStore.useLore((m) => m)
  const lore = useMemo(
    () => [...loreRows.values()].filter((l) => l.branchId === branchId),
    [loreRows, branchId],
  )
  const relationshipRows = characterRelationshipsStore.useRelationships((m) => m)
  const involvementRows = happeningInvolvementsStore.useInvolvements((m) => m)
  const happeningRows = happeningsStore.useHappenings((m) => m)
  const entryRows = entriesStore.useEntries((m) => m)
  const worldTime = useMemo(
    () =>
      branchWorldTime(
        [...entryRows.values()]
          .filter((e) => e.branchId === branchId)
          .sort((a, b) => a.position - b.position),
      ),
    [entryRows, branchId],
  )
  const entryIndex = useEntryIndex(branchId)
  const calendarId = open?.definition.calendarSystemId ?? DEFAULT_CALENDAR_ID
  const calendar = useMemo(() => resolveCalendar(calendarId), [calendarId])
  const signals = useRowSignals(branchId)
  const collisions = useMemo(() => deriveCollisions(entities), [entities])
  const leadId = useMemo(
    () => resolveLead(open?.definition.leadEntityId, entityRows, branchId)?.id ?? null,
    [open, entityRows, branchId],
  )
  const leadLabel =
    open == null ? null : open.definition.mode === 'adventure' ? 'you' : 'protagonist'

  const { selectedId, selection, select, startCreate } = useWorldSelection({
    initialId: initialSelection?.id ?? null,
    category,
    entities,
    lore,
    ready: open != null,
  })
  const detailOpen = isPhone && selection != null
  const selectedEntity = selection?.type === 'entity' ? selection.row : null
  const selectedLore = selection?.type === 'lore' ? selection.row : null
  const loreCategories = useMemo(() => distinctCategories(lore), [lore])

  const relationships = useMemo(
    () =>
      relationshipLinksFor(
        selectedEntity?.kind === 'character' ? selectedEntity.id : null,
        branchId,
        relationshipRows,
        entities,
      ),
    [selectedEntity, branchId, relationshipRows, entities],
  )
  const involvements = useMemo(
    () => involvementsFor(selectedEntity?.id ?? null, branchId, involvementRows, happeningRows),
    [selectedEntity, branchId, involvementRows, happeningRows],
  )
  const paneData = useMemo<EntityPaneData>(
    () => ({
      branchId,
      entities,
      relationships,
      involvements,
      entryIndex: entryIndex.index,
      worldTime,
      calendar,
      leadId,
    }),
    [
      branchId,
      entities,
      relationships,
      involvements,
      entryIndex.index,
      worldTime,
      calendar,
      leadId,
    ],
  )

  const { activeRunKind, editBlocked, gateReason, classifierRunning } = useStoryGenerationGate(
    storyId ?? undefined,
    branchId,
  )
  const openRegionPct = useOpenRegionTokens(storyId)

  const { onSession, guard, navigateGuarded } = useRowSessionGuard()
  const worldDelete = useWorldDelete(branchId, ctx, guard)
  const cancelDelete = worldDelete.cancel
  // A pending confirm's counts go stale off-screen (another surface can delete/rename the row).
  useEffect(() => {
    if (!focused) cancelDelete()
  }, [focused, cancelDelete])

  const onImported = useCallback(() => toast.success(t('world:import.imported')), [])
  const onImportRejected = useCallback(
    (code: ImportRejectionCode) => toast.error(importRejectionText(code)),
    [],
  )
  const onImportFailed = useCallback(
    (error: unknown) => {
      logger.error('app.world_import_failed', {
        branchId,
        category,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error(importFailureText())
    },
    [branchId, category],
  )
  const commitEntity = useCallback(
    (payload: EntityImport) => importEntity(branchId, payload, ctx),
    [branchId],
  )
  const commitLore = useCallback(
    (payload: LoreImport) => importLore(branchId, payload, ctx),
    [branchId],
  )
  const entityImport = useRowImport<EntityImport>({
    blocked: editBlocked,
    guard,
    select,
    commit: commitEntity,
    onImported,
    onRejected: onImportRejected,
    onFailed: onImportFailed,
  })
  const loreImport = useRowImport<LoreImport>({
    blocked: editBlocked,
    guard,
    select,
    commit: commitLore,
    onImported,
    onRejected: onImportRejected,
    onFailed: onImportFailed,
  })
  const activeImport = isEntityCategory(category) ? entityImport : loreImport
  const setEntityImportOpen = entityImport.onOpenChange
  const setLoreImportOpen = loreImport.onOpenChange
  const closeImports = useCallback(() => {
    setEntityImportOpen(false)
    setLoreImportOpen(false)
  }, [setEntityImportOpen, setLoreImportOpen])
  // The dialog is portaled: left open, it would paint over the screen pushed on top.
  useEffect(() => {
    if (!focused) closeImports()
  }, [focused, closeImports])
  const collision = useCollisionResolve(branchId, ctx, guard)
  const collisionBlocked = useCollisionGate(storyId ?? undefined, branchId)
  const { close: closeCollision, request: requestCollision } = collision
  // The dialog is portaled: left open, it would paint over the screen pushed on top.
  useEffect(() => {
    if (!focused) closeCollision()
  }, [focused, closeCollision])
  const openCollision = useCallback(
    (id: string) => {
      const target = collisions.get(id)
      if (target != null) requestCollision(id, target.otherId)
    },
    [collisions, requestCollision],
  )
  const resolveCollisionProp = useMemo(
    () => collisionResolveProp(collisionBlocked, openCollision),
    [collisionBlocked, openCollision],
  )

  const switchCategory = useCallback(
    (next: WorldCategory) => {
      closeImports()
      setCategory(next)
      select(null)
      setFilter('all')
      setSearch('')
    },
    [select, closeImports],
  )
  const selectCategory = useCallback(
    (next: WorldCategory) => guard(() => switchCategory(next)),
    [guard, switchCategory],
  )
  const selectRow = useCallback(
    (id: string) => {
      // Re-tapping the open row replaces nothing, so it must not raise the dialog.
      if (id === selectedId) return
      guard(() => select(id))
    },
    [selectedId, guard, select],
  )
  const jumpToRow = useCallback(
    (id: string) => {
      if (id === selectedId) {
        listRef.current?.revealRow(id)
        return
      }
      guard(() => {
        select(id)
        listRef.current?.revealRow(id)
      })
    },
    [selectedId, guard, select],
  )
  // Connections links may cross kinds; the list pane reveals in the same update.
  const openEntity = useCallback(
    (id: string) => {
      const target = entities.find((e) => e.id === id)
      if (target == null) return
      guard(() => {
        if (target.kind !== category) switchCategory(target.kind)
        select(id)
        listRef.current?.revealRow(id)
      })
    },
    [entities, category, guard, switchCategory, select],
  )
  const openHappening = useCallback(
    (id: string) =>
      navigateGuarded(plotHref(branchId, { kind: 'happening', id, tab: 'involvements' })),
    [navigateGuarded, branchId],
  )
  // A link set on this mounted screen (useSurfaceNavigate reuses it) selects as openEntity does,
  // and remounts the pane so it opens on the link's tab.
  const [linkMount, setLinkMount] = useState(0)
  const followLink = useCallback(
    (target: WorldSelection, atMount: boolean) => {
      if (atMount) return
      guard(() => {
        if (target.category !== category) switchCategory(target.category)
        select(target.id)
        setLinkMount((n) => n + 1)
        listRef.current?.revealRow(target.id)
      })
    },
    [category, guard, switchCategory, select],
  )
  // Stores hydrate before `open` publishes, so the linked row's pane mounts in that same commit.
  const pendingLink = useRouteLink(link, open != null, followLink)

  // One synchronous handler: the pane drops a reveal whose row isn't mounted in the same commit.
  // Phone hides the list under a selection, so deselect. A bare reveal drops no draft: unguarded.
  const onPillPress = useCallback(() => {
    const target = firstFlaggedRow({
      entities,
      flagged: collisions,
      category,
      view: { search, filter },
      signals: { leadId, inScene: signals.inScene },
    })
    if (target == null) return
    if (target.kind === category && !isPhone) {
      listRef.current?.revealRow(target.id)
      return
    }
    guard(() => {
      if (target.kind !== category) switchCategory(target.kind)
      else select(null)
      listRef.current?.revealRow(target.id)
    })
  }, [
    entities,
    collisions,
    category,
    search,
    filter,
    leadId,
    signals.inScene,
    isPhone,
    guard,
    switchCategory,
    select,
  ])

  // Phone is list-first: an open detail collapses to the list; any other back leaves, and
  // useUnsavedChangesGuard holds the pop behind the dialog while dirty.
  const handleBack = useCallback(() => {
    if (detailOpen) guard(() => select(null))
    else router.back()
  }, [detailOpen, guard, router, select])
  // Constant true: Android back always runs handleBack, so it can't leave past a dirty pane.
  useMasterDetailBack(true, handleBack)

  // The popover measures its trigger on open, and phone hides the list (and its `[+]`) under a
  // selection, so deselect. Opening the menu drops no draft; only a switch or deselect is guarded.
  const openAddMenu = useCallback(
    (target: WorldCategory) => {
      if (target === category && !isPhone) {
        setAddOpen(true)
        return
      }
      guard(() => {
        if (target !== category) switchCategory(target)
        else select(null)
        setAddOpen(true)
      })
    },
    [category, isPhone, guard, switchCategory, select],
  )

  const contextual: ActionGroup = useMemo(
    () => ({
      id: 'world',
      header: t('chrome.onThisScreen'),
      entries: [
        {
          id: 'add-entity',
          label: t('world:actions.addEntity'),
          disabled: editBlocked,
          disabledReason: gateReason,
          onActivate: () => openAddMenu(isEntityCategory(category) ? category : 'character'),
        },
        {
          id: 'add-lore',
          label: t('world:actions.addLore'),
          disabled: editBlocked,
          disabledReason: gateReason,
          onActivate: () => openAddMenu('lore'),
        },
      ],
    }),
    [editBlocked, gateReason, category, openAddMenu],
  )

  const saveRow = useCallback(
    (input: EntitySaveInput) => saveEntity({ ...input, branchId, row: selectedEntity }, ctx),
    [branchId, selectedEntity],
  )
  const saveLoreRow = useCallback(
    (draft: LoreDraft) => saveLore({ branchId, row: selectedLore, draft }, ctx),
    [branchId, selectedLore],
  )
  const onSaved = useCallback(
    (id: string) => {
      select(id)
      toast.success(t('world:save.saved'))
    },
    [select],
  )
  // The save bar's notice is an icon with no visible text, so a refused save also toasts.
  const onRejected = toast.error
  const onSetLead = useCallback(
    (id: string) => {
      if (storyId == null) return
      const name = entities.find((e) => e.id === id)?.name ?? ''
      setStoryLead(storyId, id, ctx).then(
        (result) => {
          if (result.status === 'ok') toast.success(t('world:lead.set', { name }))
          else toast.error(leadRejectionText(result.code))
        },
        (error: unknown) => {
          logger.error('app.world_set_lead_failed', {
            storyId,
            id,
            error: error instanceof Error ? error.message : String(error),
          })
          toast.error(t('world:lead.failed'))
        },
      )
    },
    [storyId, entities],
  )

  const selectedName = selectionName(selection)

  // principles.md → Master-detail sub-header: the top bar stays screen-level on every tier.
  const titleSegments: BreadcrumbSegment[] = [
    {
      key: 'story',
      label: storyTitle ?? t('reader:placeholderTitle'),
      onPress: () => navigateGuarded(`/reader-composer/${branchId}`),
    },
    { key: 'world', label: t('world:title') },
  ]
  // Breadcrumb ignores the last segment's onPress: `category` navigates only while a row follows.
  const subHeaderSegments: BreadcrumbSegment[] = [
    {
      key: 'category',
      label: worldCategoryLabel(category),
      onPress: () => guard(() => select(null)),
    },
    ...(selectedName != null ? [{ key: 'row', label: selectedName }] : []),
  ]

  const detailPane =
    selection == null ? (
      <WorldDetailPlaceholder />
    ) : selection.type === 'lore' || selection.type === 'create-lore' ? (
      <LoreDetailPane
        key={linkMount}
        branchId={branchId}
        row={selection.type === 'lore' ? selection.row : null}
        createSeq={selection.type === 'create-lore' ? selection.seq : undefined}
        categories={loreCategories}
        recentlyClassified={
          selection.type === 'lore'
            ? signals.recentlyClassified.rows.get(selection.row.id)
            : undefined
        }
        blocked={editBlocked}
        blockedReason={gateReason}
        onSave={saveLoreRow}
        onSaved={onSaved}
        onRejected={onRejected}
        onDelete={(row) => worldDelete.request({ kind: 'lore', row })}
        onSession={onSession}
        hotkeysEnabled={focused}
      />
    ) : (
      <EntityDetailPane
        key={linkMount}
        kind={selection.type === 'create' ? selection.kind : selection.row.kind}
        row={selection.type === 'entity' ? selection.row : null}
        createSeq={selection.type === 'create' ? selection.seq : undefined}
        data={paneData}
        recentlyClassified={
          selection.type === 'entity'
            ? signals.recentlyClassified.rows.get(selection.row.id)
            : undefined
        }
        blocked={editBlocked}
        blockedReason={gateReason}
        initialTab={
          selection.type === 'entity' && selection.row.id === pendingLink?.id
            ? entityTabOf(selection.row.kind, pendingLink.tab)
            : undefined
        }
        onSave={saveRow}
        onSaved={onSaved}
        onRejected={onRejected}
        onSession={onSession}
        onOpenEntity={openEntity}
        onOpenHappening={openHappening}
        onSetLead={onSetLead}
        onDelete={(row) => worldDelete.request({ kind: 'entity', row })}
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
          // The `[+]` isn't mounted before the story opens; an open armed then fires later.
          contextual={open != null ? contextual : undefined}
          story={storyId != null ? { storyId, branchId, surface: 'world' } : undefined}
          beforeNavigate={guard}
        />
      }
      statusSlot={
        <>
          <StoryStatusPill
            storyId={storyId}
            swapTarget={open?.settings.embedding_swap_target}
            activePhase={storyPillPhase(activeRunKind, classifierRunning)}
            onCancel={() => cancelStoryPillRun(storyId ?? undefined)}
            onOpenMemory={() => {
              if (storyId != null) navigateGuarded(`/story-settings/${storyId}?tab=memory`)
            }}
          />
          <CollisionReviewPill count={collisions.size} onPress={onPillPress} />
        </>
      }
    >
      {open == null ? (
        <View className="flex-1 items-center justify-center">
          <EmptyState title={t('reader:hydrationLoading')} />
        </View>
      ) : (
        // touch.md → Save bar on phone: the panes compress so the save bar rides above the IME.
        <KeyboardInsetColumn className="min-h-0">
          <MasterDetailLayout
            isRowSelected={selection != null}
            subHeader={<Breadcrumb segments={subHeaderSegments} testID="world-sub-header" />}
            listPane={
              <WorldListPane
                ref={listRef}
                category={category}
                onCategoryChange={selectCategory}
                filter={filter}
                onFilterChange={setFilter}
                search={search}
                onSearchChange={setSearch}
                entities={entities}
                lore={lore}
                selectedId={selectedId}
                onSelect={selectRow}
                signals={signals}
                leadId={leadId}
                leadLabel={leadLabel}
                collisions={collisions}
                onJumpToRow={jumpToRow}
                resolveCollision={resolveCollisionProp}
                addSlot={
                  <ImporterMenu
                    trigger="icon"
                    label={worldAddLabel(category)}
                    options={worldAddOptions(
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
      {worldDelete.copy != null ? (
        <DeleteConfirmDialog
          open={focused}
          onOpenChange={(next) => {
            if (!next) worldDelete.cancel()
          }}
          {...worldDelete.copy}
          onConfirm={worldDelete.confirm}
        />
      ) : null}
      {collision.pair != null ? (
        <CollisionResolveDialog
          open={focused}
          onOpenChange={(next) => {
            if (!next) closeCollision()
          }}
          entityA={collision.pair[0]}
          entityB={collision.pair[1]}
          onResolve={collision.resolve}
          blockedReason={collisionBlocked}
        />
      ) : null}
      {isEntityCategory(category) ? (
        <ImportDialog<EntityImport>
          {...entityImportDialog(category)}
          open={entityImport.open && focused}
          onOpenChange={entityImport.onOpenChange}
          onValidated={entityImport.onValidated}
        />
      ) : (
        <ImportDialog<LoreImport>
          {...loreImportDialog()}
          open={loreImport.open && focused}
          onOpenChange={loreImport.onOpenChange}
          onValidated={loreImport.onValidated}
        />
      )}
    </ScreenShell>
  )
}
