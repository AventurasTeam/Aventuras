import type { ProviderCapabilities, StorySettings } from '@/lib/db'

// Midpoint of the 1.5-3k happenings projected for a 30-chapter story
// (docs/memory/retrieval.md#scale-assumptions). Happenings dominate the
// embedded corpus — awareness rows are not embedded, and chapters / entities /
// lore / threads are comparatively negligible — so the storage preview scales
// off this single count, the same per-happening scaling the doc's estimate uses.
export const PROJECTED_ROWS_30CH = 2250

const FALLBACK_LADDER = [512, 1024, 2048]
const MOBILE_MIN_DIM = 512

export function disclosureVisible(
  settings: Pick<StorySettings, 'embeddingBackend'>,
  capabilities: ProviderCapabilities | undefined,
): boolean {
  return settings.embeddingBackend === 'provider' && capabilities?.matryoshkaSupported === true
}

export function dimLadder(capabilities: ProviderCapabilities | undefined): number[] {
  const dims = capabilities?.matryoshkaDims
  return dims != null && dims.length > 0 ? [...dims] : [...FALLBACK_LADDER]
}

export function suggestedDim(ladder: number[], platform: 'mobile' | 'desktop'): number | null {
  if (platform === 'desktop') return null
  const atOrAboveFloor = ladder.filter((dim) => dim >= MOBILE_MIN_DIM)
  if (atOrAboveFloor.length > 0) return Math.min(...atOrAboveFloor)
  // No curated dim reaches the mobile floor: the storage-reduction intent still
  // favors the smallest device footprint, but never below what the model offers.
  return ladder.length > 0 ? Math.max(...ladder) : null
}

export function storagePreviewBytes(dim: number): number {
  return dim * 4 * PROJECTED_ROWS_30CH
}

export type CustomDimResult =
  | { ok: true; dim: number }
  | { ok: false; reason: 'empty' | 'not-integer' | 'not-positive' }

export function validateCustomDim(raw: string): CustomDimResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  // Explicit digit-only guard: Number('12.5') coerces silently, so the regex is
  // what actually enforces the integer contract the schema locks in at Finish.
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: 'not-integer' }
  const dim = Number(trimmed)
  if (dim < 1) return { ok: false, reason: 'not-positive' }
  return { ok: true, dim }
}
