import type { Thread, ThreadStatus } from '@/lib/db'
import { normalizeTerm } from '@/lib/keyword-terms'

import { collate, compareId } from './collate'
import { textIncludes } from './search-text'
import type { ListGrouping, ListQuery, ScopeField } from './types'

// plot.md → Threads side: Active → Pending → Resolved → Failed.
export const THREAD_TIERS = [
  'active',
  'pending',
  'resolved',
  'failed',
] as const satisfies readonly ThreadStatus[]
export type ThreadTier = (typeof THREAD_TIERS)[number]

export const THREAD_FILTERS = ['all', ...THREAD_TIERS] as const
export type ThreadFilter = (typeof THREAD_FILTERS)[number]

type ThreadScopeKey = 'title' | 'description' | 'category'

// plot.md → Threads side → Search. The schema carries no `tags` column.
const THREAD_FIELDS: readonly ScopeField<Thread, ThreadScopeKey>[] = [
  { key: 'title', values: (r) => [r.title] },
  { key: 'description', values: (r) => [r.description] },
  { key: 'category', values: (r) => [r.category] },
]

/** Keys into `plot:search.scope.*`. */
export const THREAD_SEARCH_SCOPE: readonly ThreadScopeKey[] = THREAD_FIELDS.map((f) => f.key)

export function matchesThreadSearch(row: Thread, search: string): boolean {
  const needle = normalizeTerm(search)
  if (needle === '') return true
  return THREAD_FIELDS.flatMap((f) => f.values(row)).some((field) => textIncludes(field, needle))
}

const TIER_RANK: Record<ThreadTier, number> = Object.fromEntries(
  THREAD_TIERS.map((tier, index) => [tier, index]),
) as Record<ThreadTier, number>

export function compareThreads(a: Thread, b: Thread): number {
  const tierDiff = TIER_RANK[a.status] - TIER_RANK[b.status]
  if (tierDiff !== 0) return tierDiff
  return collate(a.title, b.title) || a.createdAt - b.createdAt || compareId(a.id, b.id)
}

export function queryThreads(rows: readonly Thread[], query: ListQuery<ThreadFilter>): Thread[] {
  return rows
    .filter(
      (r) =>
        (query.filter === 'all' || r.status === query.filter) &&
        matchesThreadSearch(r, query.search),
    )
    .sort(compareThreads)
}

export function groupThreadsByTier(rows: readonly Thread[]): ListGrouping<Thread, ThreadTier> {
  const groups = THREAD_TIERS.map((tier) => ({
    key: tier,
    rows: rows.filter((r) => r.status === tier),
  })).filter((group) => group.rows.length > 0)
  return { pinned: null, groups }
}
