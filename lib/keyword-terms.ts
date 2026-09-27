/**
 * The shape every keyword term is compared under. Outside `lib/retrieval` so every
 * producer of terms normalizes identically without dragging the embedder in behind it.
 */
export function normalizeTerm(s: string): string {
  return s.trim().toLowerCase().normalize('NFC')
}

/** Trimmed terms, one per `normalizeTerm` key with the first spelling kept; blanks dropped. */
export function dedupeTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const term of terms) {
    const key = normalizeTerm(term)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(term.trim())
  }
  return kept
}
