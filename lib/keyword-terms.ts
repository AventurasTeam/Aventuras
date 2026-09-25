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

/**
 * `incoming` terms `current` lacks under `normalizeTerm`, trimmed, first spelling kept;
 * blanks dropped.
 */
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
