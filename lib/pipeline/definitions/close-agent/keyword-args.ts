import { newTerms, normalizeTerm } from '@/lib/keyword-terms'

import type { CloseIds } from './ids'
import { handleInTerm } from './text-checks'

/** A keyword write's two lists, each already through `dedupeTerms`. */
export type SentKeywords = { add: readonly string[]; remove: readonly string[] }

/** A keyword holding a handle, which names nothing past this close. */
export const termHandleReason = (term: string, handle: string): string =>
  `the keyword "${term}" holds ${handle}, an id: a keyword is a word the prose uses, never an id`

const keywordInBothReason = (term: string): string =>
  `"${term}" is in both add and remove: send each term in one list`

export function firstTermHandle(
  terms: readonly string[],
  ids: CloseIds,
): { term: string; handle: string } | undefined {
  for (const term of terms) {
    const handle = handleInTerm(term, ids)
    if (handle !== undefined) return { term, handle }
  }
  return undefined
}

/** The list as a keyword write would leave it: the stored terms less the removals, then the adds. */
export function plannedKeywords(
  stored: readonly string[],
  { add, remove }: SentKeywords,
): string[] {
  const removing = new Set(remove.map(normalizeTerm))
  return [...stored.filter((term) => !removing.has(normalizeTerm(term))), ...newTerms(stored, add)]
}

/** Why a keyword write is refused whole: a term in both lists, or one holding a handle. */
export function keywordsRefusal({ add, remove }: SentKeywords, ids: CloseIds): string | undefined {
  const removing = new Set(remove.map(normalizeTerm))
  const both = add.find((term) => removing.has(normalizeTerm(term)))
  if (both !== undefined) return keywordInBothReason(both)
  const held = firstTermHandle([...add, ...remove], ids)
  return held === undefined ? undefined : termHandleReason(held.term, held.handle)
}
