import type { Delta, EntityKind, StoryEntry } from '@/lib/db'

export const ROW_CATEGORIES = [
  'character',
  'location',
  'item',
  'faction',
  'lore',
  'thread',
  'happening',
] as const
export type RowCategory = (typeof ROW_CATEGORIES)[number]

/** Same literal union as `ListRowProps.recentlyClassified` (components/compounds/list-row.tsx). */
export type RecentlyClassified = 'fresh' | 'fading'

export type RecentlyClassifiedSignals = {
  rows: ReadonlyMap<string, RecentlyClassified>
  /** `fresh` if any row of the category is fresh, `fading` if every touched row is fading. */
  byCategory: ReadonlyMap<RowCategory, RecentlyClassified>
}

/**
 * Delta log positions of the create deltas of the latest `ai_reply` (`fresh`)
 * and the one before it (`fading`, null on a one-reply branch).
 */
export type TurnBoundaries = { fresh: number; fading: number | null }

export type SignalDelta = Pick<Delta, 'source' | 'targetTable' | 'targetId' | 'logPosition'>
export type SignalEntry = Pick<StoryEntry, 'id' | 'kind' | 'position' | 'metadata'>
export type SignalEntity = { id: string; kind: EntityKind }

/**
 * `deltas.target_table` keys the bounded delta read filters on, mapped to the row
 * category. A `Map`, not a plain object — a free-text table name can't resolve an inherited member.
 */
export const SIGNAL_TARGET_TABLES: ReadonlyMap<string, RowCategory | 'entity'> = new Map([
  ['entities', 'entity'],
  ['lore', 'lore'],
  ['threads', 'thread'],
  ['happenings', 'happening'],
])
