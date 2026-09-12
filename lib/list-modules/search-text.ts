import { normalizeTerm } from '@/lib/keyword-terms'

// Normalizes like retrieval does, so a retrieval match is always a search match too.
export function textIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (haystack == null || haystack === '') return false
  return normalizeTerm(haystack).includes(needle)
}
