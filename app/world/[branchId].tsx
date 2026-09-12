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
  selectStorySettingsGenerationRunKind,
  storySettingsGenerationPhase,
} from '@/components/story-settings/generation-run'
import { EmptyState } from '@/components/ui/empty-state'
import { CollisionReviewPill } from '@/components/world/collision-review-pill'
import { deriveCollisions } from '@/components/world/collisions'
import { firstFlaggedRow } from '@/components/world/first-flagged-row'
import { worldAddOptions } from '@/components/world/world-add-options'
import {
  WorldDetailPlaceholder,
  type WorldDetailSelection,
} from '@/components/world/world-detail-placeholder'
import { WorldListPane, type WorldListPaneHandle } from '@/components/world/world-list-pane'
import {
  parseWorldSelection,
  single as singleParam,
  worldAddLabel,
  worldCategoryLabel,
} from '@/components/world/world-selection'
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
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection?.id ?? null)
  const [filter, setFilter] = useState<EntityFilter>('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [failedBranchId, setFailedBranchId] = useState<string | null>(null)
  const listRef = useRef<WorldListPaneHandle>(null)

  // A cold mount (reload, deep link) hydrates the working set the way the reader does.
  useEffect(() => {
    if (branchId === '' || currentStoryStore.getCurrentStory()?.branchId === branchId) return
    let current = true
    void loadOpenStory(branchId, ctx, () => current)
      .then((result) => {
        if (current && result.status !== 'ok') setFailedBranchId(branchId)
      })
      .catch((err: unknown) => {
        logger.error('app.world_story_load_failed', {
          branchId,
          error: err instanceof Error ? err.message : String(err),
        })
        if (current) setFailedBranchId(branchId)
      })
    return () => {
      current = false
    }
  }, [branchId])
  useEffect(() => {
    // Never rejects: internally try/caught, logs bootstrap.stories_hydrate_failed on its own.
    void rehydrateStories(db)
  }, [])

  const open = currentStoryStore.useCurrentStory((o) => (o?.branchId === branchId ? o : null))
  const loadFailed = branchId === '' || failedBranchId === branchId
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

  const selection = useMemo<WorldDetailSelection | null>(() => {
    if (selectedId == null) return null
    if (isEntityCategory(category)) {
      const row = entities.find((e) => e.id === selectedId && e.kind === category)
      return row == null ? null : { category, row }
    }
    const row = lore.find((l) => l.id === selectedId)
    return row == null ? null : { category: 'lore', row }
  }, [selectedId, category, entities, lore])
  // Keyed on the resolved row, not the id: a stale deep-link id already shows the list.
  const detailOpen = isPhone && selection != null

  const activeRunKind = generationStore.useGeneration((s) =>
    selectStorySettingsGenerationRunKind(s.txState, storyId ?? undefined),
  )
  const editBlocked = generationStore.useGeneration((s) => isUserEditBlocked(s.txState))
  const gateReason = editBlocked
    ? t(
        activeRunKind === 'chapter-close'
          ? 'generationGate.chapterClose'
          : 'generationGate.inFlight',
      )
    : undefined
  const openRegionPct = useOpenRegionTokens(storyId)
  const memoryHealth = useMemoryHealth(storyId, open?.settings.embedding_swap_target)

  const selectCategory = useCallback((next: WorldCategory) => {
    setCategory(next)
    setSelectedId(null)
    setFilter('all')
    setSearch('')
  }, [])

  const jumpToRow = useCallback((id: string) => {
    setSelectedId(id)
    listRef.current?.revealRow(id)
  }, [])

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
  ])

  // Phone is list-first: an open detail collapses to the list; any other back leaves.
  const handleBack = useCallback(() => {
    if (detailOpen) setSelectedId(null)
    else router.back()
  }, [detailOpen, router])
  useMasterDetailBack(detailOpen, handleBack)

  // The popover measures its trigger on open, and phone hides the list (and its
  // `[+]`) while a row is selected.
  const openAddMenu = useCallback(
    (target: WorldCategory) => {
      if (target !== category) selectCategory(target)
      if (isPhone) setSelectedId(null)
      setAddOpen(true)
    },
    [category, isPhone, selectCategory],
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
            label: selection.category === 'lore' ? selection.row.title : selection.row.name,
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
          {loadFailed ? (
            <EmptyState
              title={t('reader:hydrationFailedTitle')}
              subtext={t('reader:hydrationFailedBody')}
            />
          ) : (
            <EmptyState title={t('reader:hydrationLoading')} />
          )}
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
              // Resolve is disabled via resolveDisabledReason, so this callback never fires.
              onResolveCollision={() => {}}
              resolveDisabledReason={t('world:collision.resolveReason')}
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
