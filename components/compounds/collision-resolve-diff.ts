import type { Entity, EntityKind, InjectionMode } from '@/lib/db'
import { dedupeTerms, normalizeTerm } from '@/lib/keyword-terms'

export type ScalarField =
  | 'name'
  | 'description'
  | 'status'
  | 'retiredReason'
  | 'injectionMode'
  | 'priority'

export type TermPartition = { onlyInA: string[]; onlyInB: string[]; both: string[] } | null

export type EntitySummary = {
  id: string
  kind: EntityKind
  createdAt: string // ISO
  name: string
  description?: string
  status: Entity['status']
  retiredReason?: string
  injectionMode: InjectionMode
  priority: number
  tags: string[]
  keywords: string[]
  state: Record<string, unknown>
  relationCounts: {
    awarenessRows: number
    involvements: number
    /** This side's relationship rows except the one joining the pair, which the merge drops. */
    relationships: number
    /** A relationship row joins the two rows; the merge drops it rather than moving it. */
    joiningRelationship: boolean
    inverseRefs: number
    embeddings: 0 | 1
    /** Dropped with the merge: the entity's translations and its relationships'. */
    translationRows: number
    /** Items this side carries that nothing else holds or places; a merge leaves them unheld. */
    unheldItems: number
    /**
     * What gives way when this side loses, because the other side already has it: awareness and
     * involvement rows dropped, relationships whose other end the partner already relates to
     * (the partner keeps its own views), and, on an item, holders who lose it because the partner
     * item already has a position (held or placed). Mirrors `EntityMergePlan.dropped`.
     */
    overlap: {
      awareness: number
      involvements: number
      relationships: number
      holdersLosingItem: number
    }
  }
}

export type DiffPayload = {
  divergentScalars: ScalarField[]
  tags: TermPartition
  keywords: TermPartition
  stateDivergent: boolean
}

export type Resolution =
  | {
      mode: 'merge'
      canonicalId: string
      fieldChoices: Record<ScalarField, 'A' | 'B'>
      finalTags: string[]
      finalKeywords: string[]
    }
  | {
      mode: 'rename'
      renames: { id: string; newName: string }[]
    }
  | { mode: 'keep' }

// Fixed scalar order for stable rendering. Matches the spec's
// table column order in world.md → Merge.
export const SCALAR_FIELDS: readonly ScalarField[] = [
  'name',
  'description',
  'status',
  'retiredReason',
  'injectionMode',
  'priority',
]

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // `==` catches both null and undefined; falls back to strict so
  // null vs undefined returns false.
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/** null when the two sides hold the same set, order aside — nothing to choose between. */
function partition(a: readonly string[], b: readonly string[]): TermPartition {
  const aSet = new Set(a)
  const bSet = new Set(b)
  const onlyInA = a.filter((t) => !bSet.has(t)).sort()
  const onlyInB = b.filter((t) => !aSet.has(t)).sort()
  if (onlyInA.length === 0 && onlyInB.length === 0) return null
  return { onlyInA, onlyInB, both: a.filter((t) => bSet.has(t)).sort() }
}

/** `normalizeTerm` key → the spelling the merge writes: `dedupeTerms`' trimmed first spelling. */
function firstSpellings(terms: readonly string[]): Map<string, string> {
  return new Map(dedupeTerms(terms).map((term) => [normalizeTerm(term), term]))
}

/** `partition` by `normalizeTerm`: a case variant is one keyword, in A's spelling when shared. */
function keywordPartition(a: readonly string[], b: readonly string[]): TermPartition {
  const inA = firstSpellings(a)
  const inB = firstSpellings(b)
  const only = (side: Map<string, string>, other: Map<string, string>) =>
    [...side].filter(([key]) => !other.has(key)).map(([, term]) => term)
  const onlyInA = only(inA, inB).sort()
  const onlyInB = only(inB, inA).sort()
  if (onlyInA.length === 0 && onlyInB.length === 0) return null
  const both = [...inA]
    .filter(([key]) => inB.has(key))
    .map(([, term]) => term)
    .sort()
  return { onlyInA, onlyInB, both }
}

/** The keyword chips a merge offers, sorted; a shared keyword takes the canonical's spelling. */
export function keywordUnion(
  partition: TermPartition,
  canonicalKeywords: readonly string[],
): string[] {
  if (partition == null) return []
  const canonicalSpelling = firstSpellings(canonicalKeywords)
  const shared = partition.both.map((term) => canonicalSpelling.get(normalizeTerm(term)) ?? term)
  return [...shared, ...partition.onlyInA, ...partition.onlyInB].sort()
}

/**
 * What a merge submits for a term list: the canonical's own entries in their stored order, minus
 * the deselected, then the other side's additions (`offered` order). A selection equal to the
 * canonical's set therefore comes back as the canonical's list, which the planner doesn't write.
 * `keyOf` is the identity a deselect is recorded under.
 */
export function selectedTerms({
  own,
  offered,
  deselected,
  keyOf,
}: {
  own: readonly string[]
  offered: readonly string[]
  deselected: readonly string[]
  keyOf: (term: string) => string
}): string[] {
  const ownKeys = new Set(own.map(keyOf))
  const kept = (term: string) => !deselected.includes(keyOf(term))
  return [...own.filter(kept), ...offered.filter((term) => !ownKeys.has(keyOf(term)) && kept(term))]
}

export function computeDivergence(a: EntitySummary, b: EntitySummary): DiffPayload {
  return {
    divergentScalars: SCALAR_FIELDS.filter((f) => a[f] !== b[f]),
    tags: partition(a.tags, b.tags),
    keywords: keywordPartition(a.keywords, b.keywords),
    stateDivergent: !deepEqual(a.state, b.state),
  }
}
