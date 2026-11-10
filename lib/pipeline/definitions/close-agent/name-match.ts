import { normalizeTerm } from '@/lib/keyword-terms'
import { matchTerms } from '@/lib/retrieval'

// A hand-edited row may hold anything in its keywords; only strings are terms.
const termsOf = (keywords: unknown): string[] =>
  Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === 'string') : []

/** Whether the prose names the row by its name or a keyword, whole words as retrieval matches. */
export function namedInProse(prose: string, row: { name: string; keywords: unknown }): boolean {
  // matchTerms lowercases only the prose, so the terms arrive normalized.
  const terms = [row.name, ...termsOf(row.keywords)]
    .map(normalizeTerm)
    .filter((term) => term !== '')
  return matchTerms(prose, terms).length > 0
}
