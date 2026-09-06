export type EntityKind = 'character' | 'location' | 'item' | 'faction'

export type EntityStatus = 'active' | 'staged' | 'retired'

export type InjectionMode = 'always' | 'on-relevance' | 'never'

export type ScalarField = 'name' | 'description' | 'status' | 'retiredReason' | 'injectionMode'

export type TermPartition = { onlyInA: string[]; onlyInB: string[]; both: string[] } | null

export type EntitySummary = {
  id: string
  kind: EntityKind
  createdAt: string
  name: string
  description?: string
  status: EntityStatus
  retiredReason?: string
  injectionMode: InjectionMode
  priority: number
  tags: string[]
  keywords: string[]
  state: Record<string, unknown>
  relationCounts: {
    awarenessRows: number
    involvements: number
    inverseRefs: number
    embeddings: 0 | 1
    translationRows: number
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
export const SCALAR_FIELDS: ScalarField[] = [
  'name',
  'description',
  'status',
  'retiredReason',
  'injectionMode',
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

export function computeDivergence(a: EntitySummary, b: EntitySummary): DiffPayload {
  return {
    divergentScalars: SCALAR_FIELDS.filter((f) => a[f] !== b[f]),
    tags: partition(a.tags, b.tags),
    keywords: partition(a.keywords, b.keywords),
    stateDivergent: !deepEqual(a.state, b.state),
  }
}
