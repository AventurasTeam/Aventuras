import { MODEL_TERM_MAX, modelTermFits, newTerms, normalizeTerm } from '@/lib/keyword-terms'

import type { CloseIds } from './ids'
import { keyedReason } from './reason-key'
import { handleInTerm } from './text-checks'

/** A keyword write's two lists, each already through `dedupeTerms`. */
export type SentKeywords = { add: readonly string[]; remove: readonly string[] }

/** A keyword holding a handle, which names nothing past this close. */
export const termHandleReason = (term: string, handle: string): string =>
  keyedReason(
    'keyword-holds-id',
    `the keyword "${term}" holds ${handle}, an id: a keyword is a word the prose uses, never an id`,
  )

const keywordInBothReason = (term: string): string =>
  keyedReason('keyword-in-both', `"${term}" is in both add and remove: send each term in one list`)

const keywordTooLongReason = (term: string): string => {
  const trimmed = term.trim()
  // By code point, so the quoted start never ends on half a surrogate pair.
  const start = Array.from(trimmed).slice(0, 40).join('')
  return keyedReason(
    'keyword-too-long',
    `the keyword starting "${start}" runs ${trimmed.length} characters, over ${MODEL_TERM_MAX}: a keyword is a name or short phrase the prose uses`,
  )
}

function firstTermHandle(
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

/**
 * Why a keyword write is refused whole: a term in both lists, or an add holding a handle or over
 * the model's bound. A removal stores nothing, so neither a handle nor a length in one matters.
 */
export function keywordsRefusal({ add, remove }: SentKeywords, ids: CloseIds): string | undefined {
  const removing = new Set(remove.map(normalizeTerm))
  const both = add.find((term) => removing.has(normalizeTerm(term)))
  if (both !== undefined) return keywordInBothReason(both)
  const held = firstTermHandle(add, ids)
  if (held !== undefined) return termHandleReason(held.term, held.handle)
  const long = add.find((term) => !modelTermFits(term))
  return long === undefined ? undefined : keywordTooLongReason(long)
}
