import type { Entity } from '@/lib/db'
import { dedupeTerms, normalizeTerm } from '@/lib/keyword-terms'

import { cleanList } from './draft-text'

type TermSide = Pick<Entity, 'name' | 'tags' | 'keywords'>

export type MergeDeselections = {
  /** Tags the user dropped, matched trimmed. */
  deselectedTags: readonly string[]
  /** Keywords the user dropped, matched by `normalizeTerm`. */
  deselectedKeywords: readonly string[]
}

export type MergeTermChoices = MergeDeselections & {
  /** The merged row takes the other row's name. */
  nameFromOther: boolean
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
 * The name the merge doesn't keep when it joins the keyword union (world.md → Merge); null when the
 * names are the same or the merged row already answers to it by its kept name or either row's
 * keywords.
 */
export function addedNameKeyword(
  rows: { canonical: TermSide; other: TermSide },
  nameFromOther: boolean,
): string | null {
  const { canonical, other } = rows
  const kept = nameFromOther ? other.name : canonical.name
  const notKept = (nameFromOther ? canonical.name : other.name).trim()
  const key = normalizeTerm(notKept)
  if (key === '' || key === normalizeTerm(kept)) return null
  const keywords = [...canonical.keywords, ...other.keywords]
  return keywords.some((keyword) => normalizeTerm(keyword) === key) ? null : notKept
}

/**
 * collision-resolve.md → Resolution shape: the canonical's own terms in stored order minus the
 * deselected, then the other row's remaining additions, the name the merge doesn't keep among
 * them, sorted as the dialog offers them.
 */
export function mergedTerms(
  rows: { canonical: TermSide; other: TermSide },
  choices: MergeTermChoices,
): MergedTerms {
  const { canonical, other } = rows
  const name = addedNameKeyword(rows, choices.nameFromOther)
  const otherKeywords = dedupeTerms(other.keywords)
  return {
    tags: union(
      uniqueTags(canonical.tags),
      uniqueTags(other.tags),
      choices.deselectedTags,
      trimmed,
    ),
    keywords: union(
      dedupeTerms(canonical.keywords),
      name == null ? otherKeywords : [...otherKeywords, name],
      choices.deselectedKeywords,
      normalizeTerm,
    ),
  }
}
