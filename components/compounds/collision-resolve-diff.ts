import type { Entity, EntityKind, InjectionMode } from '@/lib/db'
import { dedupeTerms, normalizeTerm } from '@/lib/keyword-terms'
import {
  cleanList,
  MERGE_SCALARS,
  mergedTerms,
  type MergeDeselections,
  type MergeOverlap,
  type MergeScalar,
} from '@/lib/world'

export type ScalarField = MergeScalar

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
    /** What gives way when this side merges into the partner. */
    overlap: MergeOverlap
  }
}

export type DiffPayload = {
  divergentScalars: ScalarField[]
  tags: TermPartition
  keywords: TermPartition
  stateDivergent: boolean
}

export type MergeResolution = {
  mode: 'merge'
  canonicalId: string
  /** Divergent fields the merged row takes from the non-canonical row, in `SCALAR_FIELDS` order. */
  fromOther: readonly ScalarField[]
} & MergeDeselections

export type Resolution =
  | MergeResolution
  | {
      mode: 'rename'
      renames: { id: string; newName: string }[]
    }
  | { mode: 'keep' }

export const SCALAR_FIELDS = MERGE_SCALARS

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

export type MergeChips = { tags: string[]; keywords: string[] }

const NO_DESELECTIONS: MergeDeselections = { deselectedTags: [], deselectedKeywords: [] }

/** The chips a merge offers, in write order; a list the two rows agree on offers none. */
export function mergeChips(
  diff: DiffPayload,
  canonical: EntitySummary,
  other: EntitySummary,
): MergeChips {
  const all = mergedTerms({ canonical, other }, NO_DESELECTIONS)
  return {
    tags: diff.tags == null ? [] : all.tags,
    keywords: diff.keywords == null ? [] : all.keywords,
  }
}

export function computeDivergence(a: EntitySummary, b: EntitySummary): DiffPayload {
  return {
    divergentScalars: SCALAR_FIELDS.filter((f) => a[f] !== b[f]),
    // Cleaned as the merge writes them, so whitespace alone offers no choice.
    tags: partition(cleanList(a.tags), cleanList(b.tags)),
    keywords: keywordPartition(a.keywords, b.keywords),
    stateDivergent: !deepEqual(a.state, b.state),
  }
}
