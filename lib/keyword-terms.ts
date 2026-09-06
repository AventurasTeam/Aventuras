/**
 * The shape every keyword term is compared under. It lives outside `lib/retrieval`
 * because the producers of terms — the classifier, the merge dialog's union, the
 * user's own edits — must normalize identically to the matcher, and a producer
 * reaching for the retrieval barrel to get it would drag the embedder in behind it.
 */
export function normalizeTerm(s: string): string {
  return s.trim().toLowerCase().normalize('NFC')
}
