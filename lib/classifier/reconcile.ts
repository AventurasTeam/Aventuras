import type { Entity } from '@/lib/db'

// Canon's starting ranges (classifier.md -> Disambiguation). Hardcoded: the
// tuning surface is parked until the M7.5 probe work.
export const TAU_HIGH = 0.75
export const TAU_LOW = 0.5

/**
 * Why a create was flagged. Canon's three bands collapse to two outcomes —
 * both the low and the ambiguous band create-with-flag — so the band survives
 * here rather than in the control flow: it is what the M4 collision-review
 * surface needs to explain the flag, and it is what makes TAU_LOW load-bearing
 * instead of decorative.
 */
export type FlagReason = 'distinct' | 'ambiguous' | 'no-signal'

export type ReconcileDecision =
  | { kind: 'create'; flagged: false }
  | { kind: 'create'; flagged: true; similarity: number | null; flagReason: FlagReason }
  | { kind: 'promote'; entityId: string; similarity: number }
  | { kind: 'known'; entityId: string; similarity: number }

export type EmbedDescriptions = (
  texts: string[],
) => Promise<{ vectors: Float32Array[]; dim: number }>

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  // Round off float32 storage noise (embeddings are Float32Array; a stored
  // 0.9 reads back as 0.8999999...) so threshold comparisons and equality
  // checks see the value the caller actually meant.
  return Math.round((dot / (Math.sqrt(na) * Math.sqrt(nb))) * 1e6) / 1e6
}

const normalizeName = (name: string) => name.trim().toLowerCase()

/**
 * Layer B reconciliation (edge-cases.md -> Layer B). Name index first, then a
 * transient similarity check between the extracted description and the
 * namesake's own description — both embedded in ONE call and compared in
 * memory, so the decision never depends on whether the namesake's vec0 row has
 * been drained yet.
 */
export async function reconcileNewCharacter(
  candidate: { name: string; description: string },
  deps: { entities: readonly Entity[]; embedDescriptions: EmbedDescriptions },
): Promise<ReconcileDecision> {
  const target = normalizeName(candidate.name)
  const namesake = deps.entities.find(
    (e) => e.kind === 'character' && normalizeName(e.name) === target,
  )
  if (!namesake) return { kind: 'create', flagged: false }

  let similarity: number | null = null
  try {
    const { vectors } = await deps.embedDescriptions([
      candidate.description,
      namesake.description ?? '',
    ])
    if (vectors.length === 2) similarity = cosine(vectors[0], vectors[1])
  } catch {
    similarity = null
  }

  // No signal: a namesake exists and we cannot tell them apart. Conservative
  // create-with-flag defers to the user rather than silently merging two
  // characters or silently promoting the wrong one.
  if (similarity == null)
    return { kind: 'create', flagged: true, similarity: null, flagReason: 'no-signal' }

  if (similarity >= TAU_HIGH) {
    return namesake.status === 'staged'
      ? { kind: 'promote', entityId: namesake.id, similarity }
      : { kind: 'known', entityId: namesake.id, similarity }
  }
  return {
    kind: 'create',
    flagged: true,
    similarity,
    flagReason: similarity < TAU_LOW ? 'distinct' : 'ambiguous',
  }
}
