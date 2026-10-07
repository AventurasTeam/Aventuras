import { useCallback, useMemo } from 'react'

import type { LeadLabel, RowSignals } from '@/components/list/list-module'
import { useRowSignals } from '@/hooks/use-row-signals'
import type { Entity, Happening, Lore, Thread } from '@/lib/db'
import type { EntityListSignals } from '@/lib/list-modules'
import { aggregateTint, railStripModel, type RailStripModel } from '@/lib/reader-rail'
import type { RecentlyClassified, RowCategory } from '@/lib/row-signals'
import {
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  happeningsStore,
  loreStore,
  threadsStore,
} from '@/lib/stores'
import { resolveLead } from '@/lib/world'

export type RailData = {
  /** The branch whose entry index the happening list reads. */
  branchId: string
  /** The branch's entities, every kind. */
  entities: readonly Entity[]
  lore: readonly Lore[]
  threads: readonly Thread[]
  happenings: readonly Happening[]
  entityListSignals: EntityListSignals
  /** Offers the happening list's `This chapter` filter. */
  hasClosedChapters: boolean
  /** Lead, in-scene and recently-classified; never `collision` (World resolves collisions). */
  rowSignals: (id: string) => Omit<RowSignals, 'collision'>
  categoryTint: ReadonlyMap<RowCategory, RecentlyClassified>
}

/** The collapsed strip, counted and tinted from the same rows and signals the rail lists. */
export function railStripOf(data: RailData): RailStripModel {
  return railStripModel({
    inScene: data.entityListSignals.inScene,
    entities: data.entities,
    byCategory: data.categoryTint,
  })
}

/** The phone Browse chip's tint: the strongest of every category's. */
export function railChipTintOf(data: RailData): RecentlyClassified | undefined {
  return aggregateTint(data.categoryTint)
}

/**
 * What every rail view reads, computed once per reader so each tier's rail shares it; the
 * happening list's entry index is read by the list, so it follows what is mounted.
 */
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
  const rowSignals = useCallback(
    (id: string): Omit<RowSignals, 'collision'> => ({
      lead: id === leadId ? leadLabel : null,
      inScene: inScene.has(id),
      recentlyClassified: rowTints.get(id),
    }),
    [leadId, leadLabel, inScene, rowTints],
  )
  return useMemo(
    () => ({
      branchId,
      entities,
      lore,
      threads,
      happenings,
      entityListSignals,
      hasClosedChapters,
      rowSignals,
      categoryTint: byCategory,
    }),
    [
      branchId,
      entities,
      lore,
      threads,
      happenings,
      entityListSignals,
      hasClosedChapters,
      rowSignals,
      byCategory,
    ],
  )
}
