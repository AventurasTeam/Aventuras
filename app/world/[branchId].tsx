import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/compounds/breadcrumb'
import { ImporterMenu } from '@/components/compounds/importer-menu'
import { StoryStatusPill } from '@/components/compounds/story-status-pill'
import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { ScreenShell } from '@/components/shells/screen-shell'
import { storyPillPhase, useStoryGenerationGate } from '@/components/story-settings/generation-run'
import { EmptyState } from '@/components/ui/empty-state'
import { KeyboardInsetColumn } from '@/components/ui/keyboard-inset-column'
import { CollisionReviewPill } from '@/components/world/collision-review-pill'
import { deriveCollisions } from '@/components/world/collisions'
import { EntityDetailPane } from '@/components/world/detail/entity-detail-pane'
import type { EntityPaneData } from '@/components/world/detail/entity-pane-props'
import { entityTabOf } from '@/components/world/detail/entity-tabs'
import { firstFlaggedRow } from '@/components/world/first-flagged-row'
import { useWorldDeepLink } from '@/components/world/use-world-deep-link'
import { useWorldSelection } from '@/components/world/use-world-selection'
import { worldAddOptions } from '@/components/world/world-add-options'
import { leadRejectionText } from '@/components/world/world-copy'
import { WorldDetailPlaceholder } from '@/components/world/world-detail-placeholder'
import { WorldListPane, type WorldListPaneHandle } from '@/components/world/world-list-pane'
import { involvementsFor, relationshipLinksFor } from '@/components/world/world-route-data'
import {
  parseWorldSelection,
  single as singleParam,
  worldAddLabel,
  worldCategoryLabel,
} from '@/components/world/world-selection'
import { useColdOpenStory } from '@/hooks/use-cold-open-story'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useIsRouteFocused } from '@/hooks/use-is-route-focused'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useOpenRegionTokens } from '@/hooks/use-open-region-tokens'
import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import { useRowSignals } from '@/hooks/use-row-signals'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import { useTier } from '@/hooks/use-tier'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { saveEntity, setStoryLead } from '@/lib/actions'
import { DEFAULT_CALENDAR_ID, resolveCalendar } from '@/lib/calendar'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { isEntityCategory, type EntityFilter, type WorldCategory } from '@/lib/list-modules'
import {
  awaitRunTerminal,
  characterRelationshipsStore,
  entitiesStore,
  entriesStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  storiesStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'
import { branchWorldTime, type EntitySaveInput } from '@/lib/world'

const ctx = { db, runInTransaction }

export default function WorldRoute() {
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
  // Params seed the initial state only (the story-settings `?tab=` precedent).
  const [initialSelection] = useState(() =>
    parseWorldSelection({ kind: params.kind, id: params.id, tab: params.tab }),
  )
  const [category, setCategory] = useState<WorldCategory>(initialSelection?.category ?? 'character')
  const [filter, setFilter] = useState<EntityFilter>('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [session, setSession] = useState<RowSessionHandle | null>(null)
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
  const leadId = open?.definition.leadEntityId ?? null
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
  // Stores hydrate before `open` publishes, so the linked row's pane mounts in that same commit.
  const pendingLink = useWorldDeepLink(initialSelection, open != null)

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
      entities,
      relationships,
      involvements,
      entryIndex: entryIndex.index,
      worldTime,
      calendar,
      leadId,
    }),
    [entities, relationships, involvements, entryIndex.index, worldTime, calendar, leadId],
  )

  const { activeRunKind, editBlocked, gateReason, classifierRunning } = useStoryGenerationGate(
    storyId ?? undefined,
    branchId,
  )
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
  const navigateGuarded = useCallback(
    (path: string) => guard(() => surfaceNavigate(path)),
    [guard, surfaceNavigate],
  )

  const switchCategory = useCallback(
    (next: WorldCategory) => {
      setCategory(next)
      select(null)
      setFilter('all')
      setSearch('')
    },
    [select],
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
  // Overview and Connections links may cross kinds; the list pane reveals in the same update.
  const openEntity = useCallback(
    (id: string) => {
      const target = entities.find((e) => e.id === id)
      if (target == null) return
      guard(() => {
        if (target.kind !== category) {
          setCategory(target.kind)
          setFilter('all')
          setSearch('')
        }
        select(id)
        listRef.current?.revealRow(id)
      })
    },
    [entities, category, guard, select],
  )
  const openHappening = useCallback(
    (id: string) => navigateGuarded(`/plot/${branchId}?kind=happening&id=${id}&tab=involvements`),
    [navigateGuarded, branchId],
  )

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

  const selectedName =
    selection == null
      ? null
      : selection.type === 'create'
        ? t(`world:detail.newEntity.${selection.kind}`)
        : selection.type === 'lore'
          ? selection.row.title
          : selection.row.name

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
    selection == null || selection.type === 'lore' ? (
      <WorldDetailPlaceholder
        selection={selection}
        recentlyClassified={
          selection != null ? signals.recentlyClassified.rows.get(selection.row.id) : undefined
        }
      />
    ) : (
      <EntityDetailPane
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
        onSession={setSession}
        onOpenEntity={openEntity}
        onOpenHappening={openHappening}
        onSetLead={onSetLead}
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
            onCancel={() => {
              if (activeRunKind != null) void awaitRunTerminal(activeRunKind, branchId, 'cancel')
            }}
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
                resolveCollision={{ disabledReason: t('world:collision.resolveReason') }}
                addSlot={
                  <ImporterMenu
                    trigger="icon"
                    label={worldAddLabel(category)}
                    options={worldAddOptions(category, () => guard(startCreate), {
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
