import type { Story as StoryRow } from '@/lib/db'

import { toStoryCardData, type StoryCardData } from './view-model'

export type StoryFilter = 'all' | 'favorited' | 'archived'
export type StorySort = 'last-opened' | 'created' | 'title'
export type StoryListQuery = { search: string; filter: StoryFilter; sort: StorySort }

function matchesFilter(r: StoryRow, filter: StoryFilter): boolean {
  if (filter === 'archived') return r.status === 'archived'
  if (r.status === 'archived') return false // archived rows live only under the Archived filter
  return filter === 'all' || r.favorite === 1
}

function matchesSearch(r: StoryRow, q: string): boolean {
  if (q === '') return true
  const needle = q.toLowerCase()
  const def = (r.definition ?? null) as { genre?: { label?: string | null } | null } | null
  const haystacks = [r.title, r.description ?? '', def?.genre?.label ?? '', ...(r.tags ?? [])]
  return haystacks.some((h) => h.toLowerCase().includes(needle))
}

function compare(a: StoryRow, b: StoryRow, sort: StorySort): number {
  // Layer 0: favorite floats first within every filter.
  if (a.favorite !== b.favorite) return b.favorite - a.favorite
  if (sort === 'title') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  if (sort === 'created') return b.createdAt - a.createdAt
  const av = a.lastOpenedAt ?? 0
  const bv = b.lastOpenedAt ?? 0
  if (av === bv) return 0
  return bv - av
}

export function selectStoryCards(
  rows: StoryRow[],
  query: StoryListQuery,
  nowMs: number,
): StoryCardData[] {
  return rows
    .filter((r) => matchesFilter(r, query.filter) && matchesSearch(r, query.search))
    .sort((a, b) => compare(a, b, query.sort))
    .map((r) => toStoryCardData(r, nowMs))
}
