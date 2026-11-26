import { normalizeTerm } from '@/lib/keyword-terms'

/** How a list's terms match: keywords and tags by `normalizeTerm`, the rest exactly. */
export type TermMatch = 'normalized' | 'exact'

/** What a write did to one term: its presence or its spelling. */
export type TermChange = 'added' | 'removed' | 'respelled'

function termKeyOf(term: string, match: TermMatch): string {
  return match === 'normalized' ? normalizeTerm(term) : term
}

/**
 * Each term's spelling by match key. A list is a set (generation-pipeline.md → Reverse-replay): a
 * duplicate is one term, spelled as its first occurrence.
 */
export function termSpellings(list: readonly string[], match: TermMatch): Map<string, string> {
  const byKey = new Map<string, string>()
  for (const term of list) {
    const key = termKeyOf(term, match)
    if (!byKey.has(key)) byKey.set(key, term)
  }
  return byKey
}

/** Each term, by match key, whose presence or spelling differs from `prior` to `result`. */
export function termChanges(
  prior: readonly string[],
  result: readonly string[],
  match: TermMatch,
): Map<string, TermChange> {
  const before = termSpellings(prior, match)
  const after = termSpellings(result, match)
  const changes = new Map<string, TermChange>()
  for (const [key, spelling] of before) {
    const now = after.get(key)
    if (now === undefined) changes.set(key, 'removed')
    else if (now !== spelling) changes.set(key, 'respelled')
  }
  for (const key of after.keys()) if (!before.has(key)) changes.set(key, 'added')
  return changes
}

/**
 * `list` with one term's change undone against the write's `prior` list: an added term goes, a
 * removed one returns in its prior spelling after the nearest earlier prior term still present
 * (else first), a respelled one takes its prior spelling back. A change the list no longer shows
 * (a term already gone, already back, or absent from `prior`) leaves it as it is.
 */
export function undoTermChange(
  list: readonly string[],
  key: string,
  change: TermChange,
  prior: readonly string[],
  match: TermMatch,
): string[] {
  const at = list.findIndex((term) => termKeyOf(term, match) === key)
  if (change === 'added') return list.filter((term) => termKeyOf(term, match) !== key)
  const priorAt = prior.findIndex((term) => termKeyOf(term, match) === key)
  if (priorAt === -1) return [...list]
  const spelling = prior[priorAt]
  if (change === 'respelled') {
    if (at === -1) return [...list]
    return list.map((term, i) => (i === at ? spelling : term))
  }
  if (at !== -1) return [...list]
  const present = new Set(list.map((term) => termKeyOf(term, match)))
  for (let i = priorAt - 1; i >= 0; i--) {
    const anchor = termKeyOf(prior[i], match)
    if (!present.has(anchor)) continue
    const after = list.findIndex((term) => termKeyOf(term, match) === anchor)
    return [...list.slice(0, after + 1), spelling, ...list.slice(after + 1)]
  }
  return [spelling, ...list]
}
