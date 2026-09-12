import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/compounds/breadcrumb'
import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { ImporterMenu } from '@/components/compounds/importer-menu'
import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { ScreenShell } from '@/components/shells/screen-shell'
import {
  generationGateReason,
  selectStorySettingsGenerationRunKind,
  storySettingsGenerationPhase,
} from '@/components/story-settings/generation-run'
import { EmptyState } from '@/components/ui/empty-state'
import { CollisionReviewPill } from '@/components/world/collision-review-pill'
import { deriveCollisions } from '@/components/world/collisions'
import { firstFlaggedRow } from '@/components/world/first-flagged-row'
import { useWorldSelection } from '@/components/world/use-world-selection'
import { worldAddOptions } from '@/components/world/world-add-options'
import { WorldDetailPlaceholder } from '@/components/world/world-detail-placeholder'
import { WorldListPane, type WorldListPaneHandle } from '@/components/world/world-list-pane'
import {
  parseWorldSelection,
  single as singleParam,
  worldAddLabel,
  worldCategoryLabel,
} from '@/components/world/world-selection'
import { useLeaveFailedStoryOpen } from '@/hooks/use-leave-failed-story-open'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { memoryPillError, useMemoryHealth } from '@/hooks/use-memory-health'
import { useOpenRegionTokens } from '@/hooks/use-open-region-tokens'
import { useRowSignals } from '@/hooks/use-row-signals'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import { useTier } from '@/hooks/use-tier'
import { loadOpenStory } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { isEntityCategory, type EntityFilter, type WorldCategory } from '@/lib/list-modules'
import {
  awaitRunTerminal,
  currentStoryStore,
  entitiesStore,
  generationStore,
  isUserEditBlocked,
  loreStore,
  rehydrateStories,
  storiesStore,
} from '@/lib/stores'

const ctx = { db, runInTransaction }

export default function WorldRoute() {
  const router = useRouter()
  const surfaceNavigate = useSurfaceNavigate()
  const isPhone = useTier() === 'phone'
  const params = useLocalSearchParams<{
    branchId?: string | string[]
    kind?: string | string[]
    id?: string | string[]
    tab?: string | string[]
  }>()
  const branchId = singleParam(params.branchId) ?? ''
  // Params seed the initial state only (the story-settings `?tab=` precedent);
  // `tab` is carried for the detail pane's tabs.
  const [initialSelection] = useState(() =>
    parseWorldSelection({ kind: params.kind, id: params.id, tab: params.tab }),
  )
  const [category, setCategory] = useState<WorldCategory>(initialSelection?.category ?? 'character')
  const [filter, setFilter] = useState<EntityFilter>('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const listRef = useRef<WorldListPaneHandle>(null)
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
        logger.error('app.world_story_load_failed', {
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
  const signals = useRowSignals(branchId)
  const collisions = useMemo(() => deriveCollisions(entities), [entities])
  const leadId = open?.definition.leadEntityId ?? null
  const leadLabel =
    open == null ? null : open.definition.mode === 'adventure' ? 'you' : 'protagonist'

  const { selectedId, setSelectedId, selection } = useWorldSelection({
    initialId: initialSelection?.id ?? null,
    category,
    entities,
    lore,
    ready: open != null,
  })
  const detailOpen = isPhone && selection != null

  const activeRunKind = generationStore.useGeneration((s) =>
    selectStorySettingsGenerationRunKind(s.txState, storyId ?? undefined),
  )
  const editBlocked = generationStore.useGeneration((s) => isUserEditBlocked(s.txState))
  const gateReason = generationGateReason(editBlocked, activeRunKind)
  const openRegionPct = useOpenRegionTokens(storyId)
  const memoryHealth = useMemoryHealth(storyId, open?.settings.embedding_swap_target)

  const selectCategory = useCallback(
    (next: WorldCategory) => {
      setCategory(next)
      setSelectedId(null)
      setFilter('all')
      setSearch('')
    },
    [setSelectedId],
  )

  const jumpToRow = useCallback(
    (id: string) => {
      setSelectedId(id)
      listRef.current?.revealRow(id)
    },
    [setSelectedId],
  )

  // One synchronous handler: the pane drops a reveal whose row isn't mounted in
  // the same commit. Phone hides the list while a row is selected, so clear it.
  const onPillPress = useCallback(() => {
    const target = firstFlaggedRow({
      entities,
      flagged: collisions,
      category,
      view: { search, filter },
      signals: { leadId, inScene: signals.inScene },
    })
    if (target == null) return
    if (target.kind !== category) selectCategory(target.kind)
    else if (isPhone) setSelectedId(null)
    listRef.current?.revealRow(target.id)
  }, [
    entities,
    collisions,
    category,
    search,
    filter,
    leadId,
    signals.inScene,
    isPhone,
    selectCategory,
    setSelectedId,
  ])

  // Phone is list-first: an open detail collapses to the list; any other back leaves.
  const handleBack = useCallback(() => {
    if (detailOpen) setSelectedId(null)
    else router.back()
  }, [detailOpen, router, setSelectedId])
  useMasterDetailBack(detailOpen, handleBack)

  // The popover measures its trigger on open, and phone hides the list (and its
  // `[+]`) while a row is selected.
  const openAddMenu = useCallback(
    (target: WorldCategory) => {
      if (target !== category) selectCategory(target)
      if (isPhone) setSelectedId(null)
      setAddOpen(true)
    },
    [category, isPhone, selectCategory, setSelectedId],
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

  // Breadcrumb ignores the last segment's onPress, so parents alone navigate.
  // world.md → Mobile expression.
  const titleSegments: BreadcrumbSegment[] = [
    {
      key: 'story',
      label: storyTitle ?? t('reader:placeholderTitle'),
      onPress: () => surfaceNavigate(`/reader-composer/${branchId}`),
    },
    { key: 'world', label: t('world:title'), onPress: () => setSelectedId(null) },
    ...(detailOpen ? [{ key: 'kind', label: worldCategoryLabel(category) }] : []),
  ]
  const subHeaderSegments: BreadcrumbSegment[] = [
    { key: 'category', label: worldCategoryLabel(category), onPress: () => setSelectedId(null) },
    ...(selection != null
      ? [
          {
            key: 'row',
            label: selection.type === 'lore' ? selection.row.title : selection.row.name,
          },
        ]
      : []),
  ]

  return (
    <ScreenShell
      variant="in-story"
      title={<Breadcrumb segments={titleSegments} />}
      chapterProgress={openRegionPct}
      onBack={handleBack}
      onOpenStorySettings={() => {
        if (storyId != null) surfaceNavigate(`/story-settings/${storyId}`)
      }}
      actions={
        <AppActionsMenu
          // The `[+]` isn't mounted before the story opens; an open armed then fires later.
          contextual={open != null ? contextual : undefined}
          story={storyId != null ? { storyId, branchId, surface: 'world' } : undefined}
        />
      }
      statusSlot={
        <>
          <GenerationStatusPill
            activePhase={
              activeRunKind != null ? storySettingsGenerationPhase(activeRunKind) : undefined
            }
            error={memoryPillError(memoryHealth)}
            onCancel={() => {
              if (activeRunKind != null) void awaitRunTerminal(activeRunKind, branchId, 'cancel')
            }}
            onErrorTap={(code) => {
              if (code !== 'classifier-offline' && storyId != null)
                surfaceNavigate(`/story-settings/${storyId}?tab=memory`)
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
              onSelect={setSelectedId}
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
                  options={worldAddOptions(category)}
                  open={addOpen}
                  onOpenChange={setAddOpen}
                />
              }
            />
          }
          detailPane={
            <WorldDetailPlaceholder
              selection={selection}
              recentlyClassified={
                selection != null
                  ? signals.recentlyClassified.rows.get(selection.row.id)
                  : undefined
              }
            />
          }
        />
      )}
    </ScreenShell>
  )
}
