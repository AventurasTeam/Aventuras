import { normalizeTerm } from '@/lib/keyword-terms'

/** A row as the namesake rule reads it: its name and its stored keywords. */
export type NamesakeSide = { name: string; keywords: readonly string[] }

/** How two names match, keywords ignored. */
export type NameBasis = 'same-name' | 'contained'

export type NamesakeMatch =
  | { basis: NameBasis }
  | {
      basis: 'keyword'
      /** The row whose keywords hold the other row's name. */
      holder: 'first' | 'second'
      /** The holder's term as stored, trimmed. */
      keyword: string
    }

function wordsOf(text: string): string[] {
  return normalizeTerm(text)
    .split(/\s+/)
    .filter((word) => word !== '')
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, i) => word === b[i])
}

// Whole words, contiguous: "Kael" is inside "Kael Stormborn", "John" is not inside "Johnson".
function containsRun(longer: readonly string[], shorter: readonly string[]): boolean {
  for (let start = 0; start + shorter.length <= longer.length; start += 1)
    if (shorter.every((word, i) => longer[start + i] === word)) return true
  return false
}

/**
 * classifier.md → Disambiguation, the namesake rule on names alone. A name in a script written
 * without spaces is one word, so it matches another only exactly.
 */
export function nameBasis(first: string, second: string): NameBasis | null {
  const a = wordsOf(first)
  const b = wordsOf(second)
  if (a.length === 0 || b.length === 0) return null
  if (sameWords(a, b)) return 'same-name'
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return containsRun(longer, shorter) ? 'contained' : null
}

function keywordNaming(holder: NamesakeSide, name: string): string | null {
  const target = wordsOf(name)
  if (target.length === 0) return null
  const hit = holder.keywords.find((keyword) => sameWords(wordsOf(keyword), target))
  return hit == null ? null : hit.trim()
}

/** The namesake rule on two rows of one kind: their names first, then either row's keywords. */
export function namesakeBasis(first: NamesakeSide, second: NamesakeSide): NamesakeMatch | null {
  const byName = nameBasis(first.name, second.name)
  if (byName != null) return { basis: byName }
  const firstHolds = keywordNaming(first, second.name)
  if (firstHolds != null) return { basis: 'keyword', holder: 'first', keyword: firstHolds }
  const secondHolds = keywordNaming(second, first.name)
  if (secondHolds != null) return { basis: 'keyword', holder: 'second', keyword: secondHolds }
  return null
}
