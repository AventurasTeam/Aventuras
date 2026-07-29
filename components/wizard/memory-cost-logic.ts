import type { ProviderCapabilities, StorySettings } from '@/lib/db'

// The story length the storage preview is quoted against; ships in the copy so
// the estimate never reads as open-ended.
export const PROJECTED_CHAPTERS = 30

// Midpoint of the 1.5-3k happenings projected for a PROJECTED_CHAPTERS-length
// story (docs/memory/retrieval.md#scale-assumptions). Happenings dominate the
// embedded corpus — awareness rows are not embedded, and chapters / entities /
// lore / threads are comparatively negligible — so the storage preview scales
// off this single count, the same per-happening scaling the doc's estimate uses.
export const PROJECTED_ROWS = 2250

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
  return dim * 4 * PROJECTED_ROWS
}

export type CustomDimResult =
  | { ok: true; dim: number }
  | { ok: false; reason: 'empty' | 'not-integer' | 'not-positive' | 'above-native' }

/**
 * `nativeDim` is the model's probed `embeddingDim`. It is absent until a probe
 * answers it, and an unknown ceiling stays permissive — rejecting on a dim
 * nobody has measured would block picks that are perfectly valid.
 */
export function validateCustomDim(raw: string, nativeDim?: number): CustomDimResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  // Explicit digit-only guard: Number('12.5') coerces silently, so the regex is
  // what actually enforces the integer contract the schema locks in at Finish.
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: 'not-integer' }
  const dim = Number(trimmed)
  if (dim < 1) return { ok: false, reason: 'not-positive' }
  if (nativeDim != null && dim > nativeDim) return { ok: false, reason: 'above-native' }
  return { ok: true, dim }
}

/**
 * Truncation can only shorten a vector, so a dim above native describes nothing
 * the embedder can produce — the embed service already clamps to
 * `min(effectiveDim, native)`. Resolving to `null` (native) rather than to
 * `nativeDim` keeps the stored setting honest AND stops a server-side
 * `dimensions` hint the provider would reject. Only applies once a probe has
 * answered the ceiling; an unknown native dim is left untouched.
 */
export function clampEffectiveDim(
  effectiveDim: number | null,
  nativeDim: number | undefined,
): number | null {
  if (effectiveDim == null || nativeDim == null) return effectiveDim
  return effectiveDim > nativeDim ? null : effectiveDim
}
