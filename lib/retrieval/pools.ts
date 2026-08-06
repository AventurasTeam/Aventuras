import type { EntityKind, InjectionMode } from '@/lib/db'

import { matchTerms, normalizeTerm } from './name-index'

export type EntityRow = {
  id: string
  kind: EntityKind
  status: 'staged' | 'active' | 'retired'
  injectionMode: InjectionMode
  name: string
  description: string | null
}

export type LoreRow = {
  id: string
  title: string
  body: string | null
  injectionMode: InjectionMode
  priority: number
}

export type ThreadRow = {
  id: string
  status: 'pending' | 'active' | 'resolved' | 'failed'
  injectionMode: InjectionMode
  title: string
  description: string | null
}

export type StructuralFloor = {
  sceneEntities: readonly EntityRow[]
  currentLocation: EntityRow | null
  activeThreads: readonly ThreadRow[]
  alwaysEntities: readonly EntityRow[]
  alwaysLore: readonly LoreRow[]
  alwaysThreads: readonly ThreadRow[]
  /** Every id the floor seats — excluded from the ranker pools. */
  seatedIds: ReadonlySet<string>
}

export type StructuralFloorInput = {
  entities: readonly EntityRow[]
  lore: readonly LoreRow[]
  threads: readonly ThreadRow[]
  sceneEntityIds: readonly string[]
  currentLocationId: string | null
}

/**
 * retrieval.md → Structural floor. These bypass the ranker and consume budget
 * unconditionally. The scene and location rows are deliberately
 * injectionMode-AGNOSTIC: an active in-scene entity injects even at
 * injection_mode='disabled', because excluding it produces "who is this person
 * the narrator keeps addressing?".
 */
export function buildStructuralFloor(input: StructuralFloorInput): StructuralFloor {
  const scene = new Set(input.sceneEntityIds)

  // No entity id is null, so a null currentLocationId matches nothing.
  const currentLocation =
    input.entities.find((e) => e.id === input.currentLocationId && e.status === 'active') ?? null

  // Scene presence is kind-aware (data-model.md → Entry metadata shape):
  // sceneEntities carries characters and items, so a location should never
  // arrive here. If a classifier emits one anyway, the singleton location slot
  // is the seat that carries "we are here".
  const sceneEntities = input.entities.filter(
    (e) => e.status === 'active' && scene.has(e.id) && e.id !== currentLocation?.id,
  )
  const activeThreads = input.threads.filter((t) => t.status === 'active')

  const seatedIds = new Set<string>([
    ...sceneEntities.map((e) => e.id),
    ...(currentLocation ? [currentLocation.id] : []),
    ...activeThreads.map((t) => t.id),
  ])

  // 'always' is a user-intent override across entities / lore / threads.
  const alwaysEntities = input.entities.filter(
    (e) => e.injectionMode === 'always' && !seatedIds.has(e.id),
  )
  const alwaysLore = input.lore.filter((l) => l.injectionMode === 'always' && !seatedIds.has(l.id))
  const alwaysThreads = input.threads.filter(
    (t) => t.injectionMode === 'always' && !seatedIds.has(t.id),
  )
  for (const row of [...alwaysEntities, ...alwaysLore, ...alwaysThreads]) seatedIds.add(row.id)

  return {
    sceneEntities,
    currentLocation,
    activeThreads,
    alwaysEntities,
    alwaysLore,
    alwaysThreads,
    seatedIds,
  }
}

export type EntityPoolInput = {
  floorIds: ReadonlySet<string>
  /** Un-classified buffer prose, for Layer-A same-name suppression. */
  recentProse: string
}

// Allowlists, not fall-through: status reaches the pool through an unchecked
// positional cast in source-rows.ts, and an unrecognised value admitted here is
// wrong content in the prompt — the outcome injection_mode exists to prevent.
// Retired is decided separately; active threads are floor-seated, not pooled.
const POOLABLE_ENTITY_STATUS: ReadonlySet<string> = new Set(['staged', 'active'])
const POOLABLE_THREAD_STATUS: ReadonlySet<string> = new Set(['pending', 'resolved', 'failed'])

/**
 * retrieval.md → Three-sub-pool entity model: active off-scene, staged, and
 * retired only via injection_mode='always'. The retired branch below excludes
 * on every call — that is canon's default-exclusion — but it only ever admits
 * for a caller passing a floor narrower than buildStructuralFloor's, which
 * seats every always row itself.
 *
 * Layer-A suppression (edge-cases.md → Name collision) drops a STAGED entity
 * whose name appears in recent un-classified prose — the AI may have just
 * invented that name, and surfacing the staged namesake creates a collision in
 * the next reply. Active entities are never suppressed; their name in prose is
 * the normal case.
 */
export function filterEntityPool(rows: readonly EntityRow[], input: EntityPoolInput): EntityRow[] {
  const staged = rows.filter((r) => r.status === 'staged')
  const hits = new Set(
    matchTerms(
      input.recentProse,
      staged.map((r) => normalizeTerm(r.name)),
    ),
  )
  const suppressedIds = new Set(
    staged.filter((r) => hits.has(normalizeTerm(r.name))).map((r) => r.id),
  )

  return rows.filter((r) => {
    if (input.floorIds.has(r.id)) return false
    if (r.injectionMode === 'disabled') return false
    if (r.status === 'retired') return r.injectionMode === 'always'
    if (!POOLABLE_ENTITY_STATUS.has(r.status)) return false
    if (suppressedIds.has(r.id)) return false
    return true
  })
}

/**
 * Lore has no structural status of its own — buildStructuralFloor already seats
 * every `always` row — so the pool is everything else, minus `disabled`, which
 * "never include[s] automatically" (data-model.md → Injection modes — unified
 * enum + structural invariant).
 */
export function filterLorePool<T extends LoreRow>(
  rows: readonly T[],
  floorIds: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => !floorIds.has(r.id) && r.injectionMode !== 'disabled')
}

/** Active threads are structural; pending / resolved / failed rank, by mode. */
export function filterThreadPool(
  rows: readonly ThreadRow[],
  floorIds: ReadonlySet<string>,
): ThreadRow[] {
  return rows.filter(
    (r) =>
      !floorIds.has(r.id) && POOLABLE_THREAD_STATUS.has(r.status) && r.injectionMode !== 'disabled',
  )
}

/**
 * One KNN row reduced to what pool assembly needs. Nothing scores on
 * `distance`; the ranker computes cosine over the returned vectors instead.
 */
export type KnnHit = readonly [id: string, distance: number]

/** Union of the per-query KNN id sets, de-duplicated, first-seen order. */
export function poolIdsFromKnn(perQuery: readonly (readonly KnnHit[])[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const rows of perQuery) {
    for (const [id] of rows) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
