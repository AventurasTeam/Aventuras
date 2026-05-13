export type EntityKind = 'character' | 'location' | 'item' | 'faction'

export type EntityStatus = 'active' | 'staged' | 'retired'

export type InjectionMode = 'always' | 'on-relevance' | 'never'

export type ScalarField = 'name' | 'description' | 'status' | 'retiredReason' | 'injectionMode'

export type EntitySummary = {
  id: string
  kind: EntityKind
  createdAt: string
  name: string
  description?: string
  status: EntityStatus
  retiredReason?: string
  injectionMode: InjectionMode
  tags: string[]
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
  tags: { onlyInA: string[]; onlyInB: string[]; both: string[] } | null
  stateDivergent: boolean
}

export type Resolution =
  | {
      mode: 'merge'
      canonicalId: string
      fieldChoices: Record<ScalarField, 'A' | 'B'>
      finalTags: string[]
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

function diffScalar(a: EntitySummary, b: EntitySummary, field: ScalarField): boolean {
  return a[field] !== b[field]
}

export function computeDivergence(a: EntitySummary, b: EntitySummary): DiffPayload {
  const divergentScalars = SCALAR_FIELDS.filter((f) => diffScalar(a, b, f))

  const aTagSet = new Set(a.tags)
  const bTagSet = new Set(b.tags)
  const onlyInA = a.tags.filter((t) => !bTagSet.has(t)).sort()
  const onlyInB = b.tags.filter((t) => !aTagSet.has(t)).sort()
  const both = a.tags.filter((t) => bTagSet.has(t)).sort()
  const tags = onlyInA.length === 0 && onlyInB.length === 0 ? null : { onlyInA, onlyInB, both }

  const stateDivergent = !deepEqual(a.state, b.state)

  return { divergentScalars, tags, stateDivergent }
}
