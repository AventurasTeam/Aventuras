import { useCallback, useMemo } from 'react'

import type { LeadLabel, RowSignals } from '@/components/list/list-module'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useRowSignals } from '@/hooks/use-row-signals'
import type { Entity, Happening, Lore, Thread } from '@/lib/db'
import type { EntityListSignals, PlotListSignals } from '@/lib/list-modules'
import { aggregateTint, railStripModel, type RailStripModel } from '@/lib/reader-rail'
import type { RecentlyClassified, RowCategory } from '@/lib/row-signals'
import {
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  happeningsStore,
  loreStore,
  readerRailStore,
  threadsStore,
} from '@/lib/stores'
import { resolveLead } from '@/lib/world'

export type RailData = {
  /** The branch's entities, every kind. */
  entities: readonly Entity[]
  lore: readonly Lore[]
  threads: readonly Thread[]
  happenings: readonly Happening[]
  entityListSignals: EntityListSignals
  plotListSignals: PlotListSignals
  /**
   * The happening list waits on this: an unread index would mark every anchored happening
   * dangling. The index is read only while `readerRailStore`'s category is `happening`, so hosts
   * must drive the rail's view from that store.
   */
  entryIndex: { ready: boolean; failed: boolean; retry: () => void }
  /** Lead, in-scene and recently-classified; never `collision` (World resolves collisions). */
  rowSignals: (id: string) => Omit<RowSignals, 'collision'>
  strip: RailStripModel
  categoryTint: ReadonlyMap<RowCategory, RecentlyClassified>
  chipTint: RecentlyClassified | undefined
}

/** Everything every rail view reads, computed once per reader so each tier's rail shares it. */
export function useRailData(branchId: string): RailData {
  // Raw maps are stable between patches; arrays via useMemo.
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
  const chapterRows = chaptersStore.useChapters((m) => m)
  // The chapters store holds closed chapters only; the open region has no row.
  const hasClosedChapters = useMemo(
    () => [...chapterRows.values()].some((c) => c.branchId === branchId),
    [chapterRows, branchId],
  )
  // Only the happening list reads the index, and it is a full-branch read after every turn.
  const happeningsShown = readerRailStore.useCategory() === 'happening'
  const entryIndex = useEntryIndex(branchId, { enabled: happeningsShown })
  const { ready, failed, retry } = entryIndex
  const entryIndexState = useMemo(() => ({ ready, failed, retry }), [ready, failed, retry])
  const { inScene, recentlyClassified } = useRowSignals(branchId)
  const rowTints = recentlyClassified.rows
  const byCategory = recentlyClassified.byCategory

  // Another branch's open story says nothing about this branch's lead.
  const leadEntityId = currentStoryStore.useCurrentStory((s) =>
    s?.branchId === branchId ? s.definition.leadEntityId : null,
  )
  const mode = currentStoryStore.useCurrentStory((s) =>
    s?.branchId === branchId ? s.definition.mode : null,
  )
  // resolveLead: a reversal can leave the definition's lead dangling, which reads as no lead.
  const leadId = useMemo(
    () => resolveLead(leadEntityId, entityRows, branchId)?.id ?? null,
    [leadEntityId, entityRows, branchId],
  )
  const leadLabel: LeadLabel | null =
    mode == null ? null : mode === 'adventure' ? 'you' : 'protagonist'

  const entityListSignals = useMemo<EntityListSignals>(
    () => ({ leadId, inScene }),
    [leadId, inScene],
  )
  const plotListSignals = useMemo<PlotListSignals>(
    () => ({ entries: entryIndex.index, hasClosedChapters }),
    [entryIndex.index, hasClosedChapters],
  )
  const rowSignals = useCallback(
    (id: string): Omit<RowSignals, 'collision'> => ({
      lead: id === leadId ? leadLabel : null,
      inScene: inScene.has(id),
      recentlyClassified: rowTints.get(id),
    }),
    [leadId, leadLabel, inScene, rowTints],
  )
  const strip = useMemo(
    () => railStripModel({ inScene, entities, byCategory }),
    [inScene, entities, byCategory],
  )
  const chipTint = aggregateTint(byCategory)

  return useMemo(
    () => ({
      entities,
      lore,
      threads,
      happenings,
      entityListSignals,
      plotListSignals,
      entryIndex: entryIndexState,
      rowSignals,
      strip,
      categoryTint: byCategory,
      chipTint,
    }),
    [
      entities,
      lore,
      threads,
      happenings,
      entityListSignals,
      plotListSignals,
      entryIndexState,
      rowSignals,
      strip,
      byCategory,
      chipTint,
    ],
  )
}
