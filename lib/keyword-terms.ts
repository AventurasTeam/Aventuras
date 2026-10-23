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
