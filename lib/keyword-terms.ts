/**
 * The shape every keyword term is compared under. Outside `lib/retrieval` so every
 * producer of terms normalizes identically without dragging the embedder in behind it.
 */
export function normalizeTerm(s: string): string {
  return s.trim().toLowerCase().normalize('NFC')
}
