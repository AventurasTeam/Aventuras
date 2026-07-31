import type { Entity } from '@/lib/db'

// Canon's starting ranges (classifier.md -> Disambiguation). Hardcoded: the
// tuning surface is parked until the M7.5 probe work.
export const TAU_HIGH = 0.75
export const TAU_LOW = 0.5

/** Why a create was flagged. Both the low and the ambiguous band create-with-flag,
 * so the band is carried explicitly for the collision-review surface. */
export type FlagReason = 'distinct' | 'ambiguous' | 'no-signal'

export type ReconcileDecision =
  | { kind: 'create'; flagged: false }
  | { kind: 'create'; flagged: true; similarity: number | null; flagReason: FlagReason }
  | { kind: 'promote'; entityId: string; similarity: number }
  | { kind: 'known'; entityId: string; similarity: number }

export type EmbedDescriptions = (
  texts: string[],
) => Promise<{ vectors: Float32Array[]; dim: number }>

/** Cosine similarity in [-1, 1], rounded to 6 decimals to absorb Float32Array storage noise. */
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
  return Math.round((dot / (Math.sqrt(na) * Math.sqrt(nb))) * 1e6) / 1e6
}

const normalizeName = (name: string) => name.trim().toLowerCase()

/**
 * Layer B reconciliation (edge-cases.md -> Layer B). Every namesake is embedded
 * alongside the candidate in ONE call and compared in memory, so the decision
 * never depends on whether their vec0 rows have been drained yet.
 *
 * All namesakes, not just the first: create-with-flag deliberately produces
 * same-name rows, so a branch that has already flagged one would otherwise keep
 * scoring new candidates against whichever row happens to sort first.
 */
export async function reconcileNewCharacter(
  candidate: { name: string; description: string },
  deps: { entities: readonly Entity[]; embedDescriptions: EmbedDescriptions },
): Promise<ReconcileDecision> {
  const target = normalizeName(candidate.name)
  const namesakes = deps.entities.filter(
    (e) => e.kind === 'character' && normalizeName(e.name) === target,
  )
  if (namesakes.length === 0) return { kind: 'create', flagged: false }

  let vectors: Float32Array[] | null = null
  try {
    const result = await deps.embedDescriptions([
      candidate.description,
      ...namesakes.map((n) => n.description ?? ''),
    ])
    vectors = result.vectors
  } catch {
    vectors = null
  }

  // A short reply or a dim mismatch mid embedder-swap would otherwise be scored
  // on whatever prefix the two vectors happen to share — a fabricated similarity
  // driving a create-or-merge decision.
  const dim = vectors?.[0]?.length ?? 0
  const usable =
    vectors != null &&
    vectors.length === namesakes.length + 1 &&
    dim > 0 &&
    vectors.every((v) => v.length === dim)

  let best: { entity: Entity; similarity: number } | null = null
  if (usable && vectors != null) {
    for (const [i, namesake] of namesakes.entries()) {
      const similarity = cosine(vectors[0], vectors[i + 1])
      if (best == null || similarity > best.similarity) best = { entity: namesake, similarity }
    }
  }

  // A namesake exists but is indistinguishable: defer to the user rather than
  // silently merge or promote the wrong character.
  if (best == null)
    return { kind: 'create', flagged: true, similarity: null, flagReason: 'no-signal' }

  if (best.similarity >= TAU_HIGH) {
    return best.entity.status === 'staged'
      ? { kind: 'promote', entityId: best.entity.id, similarity: best.similarity }
      : { kind: 'known', entityId: best.entity.id, similarity: best.similarity }
  }
  return {
    kind: 'create',
    flagged: true,
    similarity: best.similarity,
    flagReason: best.similarity < TAU_LOW ? 'distinct' : 'ambiguous',
  }
}
