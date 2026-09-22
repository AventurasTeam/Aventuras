import type { Happening } from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import { normalizeTerm } from '@/lib/keyword-terms'

import { collate, compareId } from './collate'
import type { PlotListSignals } from './plot'
import { textIncludes } from './search-text'
import type { ListGrouping, ListQuery, ScopeField } from './types'

export const HAPPENING_FILTERS = [
  'all',
  'this-chapter',
  'common-knowledge',
  'out-of-narrative',
] as const
export type HappeningFilter = (typeof HAPPENING_FILTERS)[number]

// Until a chapter closes, `This chapter` equals All minus Out of narrative — hidden.
export const HAPPENING_FILTERS_NO_CHAPTER: readonly HappeningFilter[] = HAPPENING_FILTERS.filter(
  (filter) => filter !== 'this-chapter',
)

export const HAPPENING_BUCKETS = ['current', 'earlier', 'out-of-narrative'] as const
export type HappeningBucket = (typeof HAPPENING_BUCKETS)[number]

export function happeningFilters(signals: PlotListSignals): readonly HappeningFilter[] {
  return signals.hasClosedChapters ? HAPPENING_FILTERS : HAPPENING_FILTERS_NO_CHAPTER
}

// `temporal` is model-authored free text: whitespace-only reads as unset, not "has a time".
function isOutOfNarrative(row: Happening): boolean {
  return (row.temporal?.trim() ?? '') !== '' || row.occurredAtEntryId == null
}

/**
 * plot.md → Happenings side; data-model.md → Chapters. `temporal` set or no anchor → Out
 * of narrative; open chapter (anchor's `chapter_id` null) → Current; closed → Earlier. A
 * dangling anchor (entry deleted) stays Current — nothing older can claim it.
 */
export function happeningBucket(row: Happening, entries: EntryIndex): HappeningBucket {
  if (isOutOfNarrative(row)) return 'out-of-narrative'
  const entry = row.occurredAtEntryId == null ? undefined : entries.get(row.occurredAtEntryId)
  return entry?.chapterId != null ? 'earlier' : 'current'
}

type HappeningScopeKey = 'title' | 'description' | 'category'

// plot.md → Happenings side → Search. The schema carries no `tags` column.
const HAPPENING_FIELDS: readonly ScopeField<Happening, HappeningScopeKey>[] = [
  { key: 'title', values: (r) => [r.title] },
  { key: 'description', values: (r) => [r.description] },
  { key: 'category', values: (r) => [r.category] },
]

/** Keys into `plot:search.scope.*`. */
export const HAPPENING_SEARCH_SCOPE: readonly HappeningScopeKey[] = HAPPENING_FIELDS.map(
  (f) => f.key,
)

export function matchesHappeningSearch(row: Happening, search: string): boolean {
  const needle = normalizeTerm(search)
  if (needle === '') return true
  return HAPPENING_FIELDS.flatMap((f) => f.values(row)).some((field) => textIncludes(field, needle))
}

function matchesHappeningFilter(
  row: Happening,
  filter: HappeningFilter,
  entries: EntryIndex,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'this-chapter':
      return happeningBucket(row, entries) === 'current'
    case 'common-knowledge':
      return row.commonKnowledge === 1
    case 'out-of-narrative':
      return isOutOfNarrative(row)
  }
}

// A dangling anchor has no position: it sorts after every anchored row of its block.
function anchorPosition(row: Happening, entries: EntryIndex): number {
  if (row.occurredAtEntryId == null) return -1
  return entries.get(row.occurredAtEntryId)?.position ?? -1
}

// plot.md → Happenings side → Sort: entry position DESC; out-of-narrative rows sort last, by title.
export function compareHappenings(a: Happening, b: Happening, entries: EntryIndex): number {
  const aOut = isOutOfNarrative(a) ? 1 : 0
  const bOut = isOutOfNarrative(b) ? 1 : 0
  if (aOut !== bOut) return aOut - bOut
  if (aOut === 0) {
    const positionDiff = anchorPosition(b, entries) - anchorPosition(a, entries)
    if (positionDiff !== 0) return positionDiff
    const createdDiff = b.createdAt - a.createdAt
    if (createdDiff !== 0) return createdDiff
  }
  return collate(a.title, b.title) || compareId(a.id, b.id)
}

export function queryHappenings(
  rows: readonly Happening[],
  query: ListQuery<HappeningFilter>,
  signals: PlotListSignals,
): Happening[] {
  return rows
    .filter(
      (r) =>
        matchesHappeningFilter(r, query.filter, signals.entries) &&
        matchesHappeningSearch(r, query.search),
    )
    .sort((a, b) => compareHappenings(a, b, signals.entries))
}

export function groupHappeningsByBucket(
  rows: readonly Happening[],
  signals: PlotListSignals,
): ListGrouping<Happening, HappeningBucket> {
  const groups = HAPPENING_BUCKETS.map((bucket) => ({
    key: bucket,
    rows: rows.filter((r) => happeningBucket(r, signals.entries) === bucket),
  })).filter((group) => group.rows.length > 0)
  return { pinned: null, groups }
}
