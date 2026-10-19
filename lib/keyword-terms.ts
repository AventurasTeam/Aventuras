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

/**
 * A holder's stackables by normalized key. A row written before keys were normalized can
 * hold "Gold" beside "gold"; every reader sums them, so the balance a prompt shows is the
 * one a transfer debits.
 */
export function foldStackables(
  stackables: Readonly<Record<string, number>> | undefined,
): Map<string, number> {
  const folded = new Map<string, number>()
  for (const [raw, count] of Object.entries(stackables ?? {})) {
    const key = normalizeTerm(raw)
    if (key !== '' && count > 0) folded.set(key, (folded.get(key) ?? 0) + count)
  }
  return folded
}
