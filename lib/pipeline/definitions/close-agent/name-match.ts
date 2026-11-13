import { normalizeTerm } from '@/lib/keyword-terms'
import { matchTerms } from '@/lib/retrieval'

import { strings } from './row-values'

/** Whether the prose names the row by its name or a keyword, whole words as retrieval matches. */
export function namedInProse(prose: string, row: { name: string; keywords: unknown }): boolean {
  // matchTerms lowercases only the prose, so the terms arrive normalized.
  const terms = [row.name, ...strings(row.keywords)]
    .map(normalizeTerm)
    .filter((term) => term !== '')
  return matchTerms(prose, terms).length > 0
}
