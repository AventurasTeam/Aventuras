import type { Entity } from '@/lib/db'
import { dedupeTerms, normalizeTerm } from '@/lib/keyword-terms'

import { cleanList } from './draft-text'

type TermSide = Pick<Entity, 'tags' | 'keywords'>

export type MergeDeselections = {
  /** Tags the user dropped, matched trimmed. */
  deselectedTags: readonly string[]
  /** Keywords the user dropped, matched by `normalizeTerm`. */
  deselectedKeywords: readonly string[]
}

export type MergedTerms = { tags: string[]; keywords: string[] }

function union(
  own: readonly string[],
  other: readonly string[],
  deselected: readonly string[],
  keyOf: (term: string) => string,
): string[] {
  const ownKeys = new Set(own.map(keyOf))
  const dropped = new Set(deselected.map(keyOf))
  const kept = (term: string) => !dropped.has(keyOf(term))
  const added = other.filter((term) => !ownKeys.has(keyOf(term)) && kept(term)).sort()
  return [...own.filter(kept), ...added]
}

const uniqueTags = (tags: readonly string[]) => [...new Set(cleanList(tags))]
const trimmed = (tag: string) => tag.trim()

/**
 * collision-resolve.md → Resolution shape: the canonical's own terms in stored order minus the
 * deselected, then the other row's remaining additions sorted as the dialog offers them. Keywords
 * are de-duplicated by `normalizeTerm` (first spelling, so a shared one keeps the canonical's);
 * tags are trimmed and de-duplicated exactly. Every term not deselected is kept, read from `rows`.
 */
export function mergedTerms(
  rows: { canonical: TermSide; other: TermSide },
  deselected: MergeDeselections,
): MergedTerms {
  const { canonical, other } = rows
  return {
    tags: union(
      uniqueTags(canonical.tags),
      uniqueTags(other.tags),
      deselected.deselectedTags,
      trimmed,
    ),
    keywords: union(
      dedupeTerms(canonical.keywords),
      dedupeTerms(other.keywords),
      deselected.deselectedKeywords,
      normalizeTerm,
    ),
  }
}
