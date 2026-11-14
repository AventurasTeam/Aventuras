import { oneLine } from '@/lib/text'

/**
 * The shape every keyword term is compared under. Outside `lib/retrieval` so every
 * producer of terms normalizes identically without dragging the embedder in behind it.
 */
export function normalizeTerm(s: string): string {
  return s.trim().toLowerCase().normalize('NFC')
}

/** Trimmed terms, one per `normalizeTerm` key with the first spelling kept; blanks dropped. */
export function dedupeTerms(terms: readonly string[]): string[] {
  return newTerms([], terms)
}

/** `incoming` terms `current` lacks by `normalizeTerm`: trimmed, first spelling kept, no blanks. */
export function newTerms(current: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(current.map(normalizeTerm))
  const added: string[] = []
  for (const term of incoming) {
    const key = normalizeTerm(term)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    added.push(term.trim())
  }
  return added
}

/** A stackable key as the prompt shows it and a transfer matches it: one line, single-spaced. */
export function foldStackableKey(raw: string): string {
  return oneLine(normalizeTerm(raw))
}

/**
 * A holder's stackables by `foldStackableKey`, summed: a row can hold "Gold" beside "gold", or a
 * key with a line break, and the balance the writer is shown must be the one a transfer debits.
 */
export function foldStackables(
  stackables: Readonly<Record<string, number>> | undefined,
): Map<string, number> {
  const folded = new Map<string, number>()
  for (const [raw, count] of Object.entries(stackables ?? {})) {
    const key = foldStackableKey(raw)
    if (key !== '' && count > 0) folded.set(key, (folded.get(key) ?? 0) + count)
  }
  return folded
}

// Tried in order. `-s` never strips a double s (`glass`); `-es` only follows a stem that takes it
// (`torch`, `box`, `potato`), so `capes` is not `cap` + `es`.
const PLURAL_ENDINGS: readonly (readonly [plural: string, singular: string, stem?: RegExp])[] = [
  ['ies', 'y'],
  ['es', '', /(?:[sxzo]|ch|sh)$/],
  ['s', ''],
]

// A folded key is trimmed and single-spaced, so its end is its last word's end.
function heldSingular(key: string, held: ReadonlySet<string>): string | undefined {
  for (const [plural, singular, stem] of PLURAL_ENDINGS) {
    if (!key.endsWith(plural) || (plural === 's' && key.endsWith('ss'))) continue
    const base = key.slice(0, -plural.length)
    if (stem !== undefined && !stem.test(base)) continue
    const candidate = base + singular
    if (held.has(candidate)) return candidate
  }
  return undefined
}

/**
 * chapter-close.md → 3c: every record folded by `foldStackables` (a blank key or a count <= 0 is
 * dropped, so a stored `{ gold: 0 }` comes back `{}`), then each plural key moved one step onto
 * the singular some record on the branch holds (`-ies` to `y`, `-es` only after s, x, z, ch, sh or
 * o, then `-s`), counts summed; a key another key folds onto stays put. Every input id gets a
 * record; an absent one comes back empty.
 */
export function normalizeStackables(
  records: ReadonlyMap<string, Readonly<Record<string, number>> | undefined>,
): Map<string, Record<string, number>> {
  const folded = new Map<string, Map<string, number>>()
  const held = new Set<string>()
  for (const [id, record] of records) {
    const keys = foldStackables(record)
    folded.set(id, keys)
    for (const key of keys.keys()) held.add(key)
  }
  const foldsTo = new Map<string, string>()
  for (const key of held) {
    const singular = heldSingular(key, held)
    if (singular !== undefined) foldsTo.set(key, singular)
  }
  // A key that receives a fold stays put, so one pass never chains buses → bus → bu.
  const receivers = new Set(foldsTo.values())
  const normalized = new Map<string, Record<string, number>>()
  for (const [id, keys] of folded) {
    const merged = new Map<string, number>()
    for (const [key, count] of keys) {
      const target = receivers.has(key) ? key : (foldsTo.get(key) ?? key)
      merged.set(target, (merged.get(target) ?? 0) + count)
    }
    normalized.set(id, Object.fromEntries(merged))
  }
  return normalized
}

/** The same keys with the same counts, in any order; an absent record reads as empty. */
export function sameStackables(
  a: Readonly<Record<string, number>> | undefined,
  b: Readonly<Record<string, number>> | undefined,
): boolean {
  const left = Object.entries(a ?? {})
  const right = b ?? {}
  return (
    left.length === Object.keys(right).length &&
    left.every(([key, count]) => Object.hasOwn(right, key) && right[key] === count)
  )
}
