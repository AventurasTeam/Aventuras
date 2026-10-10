import type { CollisionReason, Entity } from '@/lib/db'
import { namesakeBasis } from '@/lib/world'

// Canon's starting ranges (classifier.md -> Disambiguation). Hardcoded: the
// tuning surface is parked until the M7.5 probe work.
export const TAU_HIGH = 0.75
export const TAU_LOW = 0.5

export type ReconcileDecision =
  | { kind: 'create'; flag: null }
  | { kind: 'create'; flag: { partnerId: string; reason: CollisionReason } }
  | { kind: 'promote'; entityId: string; similarity: number }
  | { kind: 'known'; entityId: string; similarity: number }

export type ScoredNamesake = {
  entity: Entity
  /** exact: namesakeBasis is same-name; partial: contained or a keyword hit. */
  match: 'exact' | 'partial'
  /** Cosine against the candidate; null when unscored. */
  similarity: number | null
  inScene: boolean
}

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

// classifier.md -> Partner and reason: score (unscored last), in scene, exact, unflagged,
// older, id.
function partnerOrder(a: ScoredNamesake, b: ScoredNamesake): number {
  if (a.similarity !== b.similarity) {
    if (a.similarity == null) return 1
    if (b.similarity == null) return -1
    return b.similarity - a.similarity
  }
  if (a.inScene !== b.inScene) return a.inScene ? -1 : 1
  if (a.match !== b.match) return a.match === 'exact' ? -1 : 1
  if (a.entity.nameCollisionFlag !== b.entity.nameCollisionFlag)
    return a.entity.nameCollisionFlag - b.entity.nameCollisionFlag
  if (a.entity.createdAt !== b.entity.createdAt) return a.entity.createdAt - b.entity.createdAt
  return a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0
}

function absorbs(n: ScoredNamesake): n is ScoredNamesake & { similarity: number } {
  if (n.match !== 'exact' || n.similarity == null) return false
  return n.similarity >= TAU_HIGH || (n.similarity >= TAU_LOW && n.inScene)
}

function qualifiesToFlag(n: ScoredNamesake): boolean {
  return n.match === 'exact' || n.inScene || n.similarity == null || n.similarity >= TAU_LOW
}

function reasonOf(partner: ScoredNamesake): CollisionReason {
  if (partner.similarity == null) return 'no-signal'
  if (partner.similarity >= TAU_HIGH) return 'alike'
  if (partner.similarity >= TAU_LOW) return 'ambiguous'
  return partner.match === 'exact' ? 'distinct' : 'in-scene'
}

/** Canon's decision table (classifier.md -> Disambiguation): the first row that applies wins. */
export function decideReconcile(namesakes: readonly ScoredNamesake[]): ReconcileDecision {
  const ordered = [...namesakes].sort(partnerOrder)
  const absorbed = ordered.find(absorbs)
  if (absorbed != null) {
    const { entity, similarity } = absorbed
    return entity.status === 'staged'
      ? { kind: 'promote', entityId: entity.id, similarity }
      : { kind: 'known', entityId: entity.id, similarity }
  }
  const partner = ordered.find(qualifiesToFlag)
  if (partner == null) return { kind: 'create', flag: null }
  return { kind: 'create', flag: { partnerId: partner.entity.id, reason: reasonOf(partner) } }
}

const hasText = (text: string | null): text is string => text != null && text.trim() !== ''

/**
 * Every scorable namesake is embedded alongside the candidate in ONE call and compared in
 * memory, so the decision never depends on whether their vec0 rows have been drained yet.
 * Index-aligned with `descriptions`; null where a namesake is unscored.
 */
async function similarities(
  candidate: string,
  descriptions: readonly (string | null)[],
  embed: EmbedDescriptions,
): Promise<(number | null)[]> {
  const unscored = descriptions.map(() => null)
  if (!hasText(candidate)) return unscored
  const sent = descriptions.flatMap((text, index) => (hasText(text) ? [{ index, text }] : []))
  if (sent.length === 0) return unscored
  let vectors: Float32Array[]
  try {
    vectors = (await embed([candidate, ...sent.map((s) => s.text)])).vectors
  } catch {
    return unscored
  }
  // A short reply or a dim mismatch mid embedder-swap would otherwise be scored on
  // whatever prefix the vectors happen to share: a fabricated similarity.
  const dim = vectors[0]?.length ?? 0
  if (vectors.length !== sent.length + 1 || dim === 0 || vectors.some((v) => v.length !== dim))
    return unscored
  const scores: (number | null)[] = [...unscored]
  for (const [i, s] of sent.entries()) scores[s.index] = cosine(vectors[0], vectors[i + 1])
  return scores
}

/**
 * Layer B reconciliation (edge-cases.md -> Layer B): the candidate against every character
 * that is its namesake, any status. Candidates in one reply are not compared with each other.
 */
export async function reconcileNewCharacter(
  candidate: { name: string; description: string; keywords: readonly string[] },
  deps: {
    entities: readonly Entity[]
    embedDescriptions: EmbedDescriptions
    /** The candidate's sourceTurn scene; null when its handle fell back to the window head. */
    scene: ReadonlySet<string> | null
  },
): Promise<ReconcileDecision> {
  const matched: Omit<ScoredNamesake, 'similarity' | 'inScene'>[] = []
  for (const entity of deps.entities) {
    if (entity.kind !== 'character') continue
    const basis = namesakeBasis(candidate, entity)?.basis
    if (basis != null) matched.push({ entity, match: basis === 'same-name' ? 'exact' : 'partial' })
  }
  if (matched.length === 0) return { kind: 'create', flag: null }

  const scores = await similarities(
    candidate.description,
    matched.map((m) => m.entity.description),
    deps.embedDescriptions,
  )
  return decideReconcile(
    matched.map((m, i) => ({
      ...m,
      similarity: scores[i],
      inScene: deps.scene?.has(m.entity.id) ?? false,
    })),
  )
}
