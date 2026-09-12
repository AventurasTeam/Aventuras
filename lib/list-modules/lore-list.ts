import type { Lore } from '@/lib/db'
import { normalizeTerm } from '@/lib/keyword-terms'

import { collate, compareId } from './collate'
import { textIncludes } from './search-text'
import type { ScopeField } from './types'

type LoreScopeKey = 'title' | 'body' | 'category' | 'tags'

const LORE_FIELDS: readonly ScopeField<Lore, LoreScopeKey>[] = [
  { key: 'title', values: (l) => [l.title] },
  { key: 'body', values: (l) => [l.body] },
  { key: 'category', values: (l) => [l.category] },
  { key: 'tags', values: (l) => l.tags },
]

/** Keys into `world:search.scope.*`. */
export const LORE_SEARCH_SCOPE: readonly LoreScopeKey[] = LORE_FIELDS.map((f) => f.key)

export function matchesLoreSearch(lore: Lore, search: string): boolean {
  const needle = normalizeTerm(search)
  if (needle === '') return true
  return LORE_FIELDS.flatMap((f) => f.values(lore)).some((field) => textIncludes(field, needle))
}

// world.md → List sort — lore.
export function compareLore(a: Lore, b: Lore): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  return collate(a.title, b.title) || a.createdAt - b.createdAt || compareId(a.id, b.id)
}

export function queryLore(rows: readonly Lore[], query: { search: string }): Lore[] {
  return rows.filter((l) => matchesLoreSearch(l, query.search)).sort(compareLore)
}
