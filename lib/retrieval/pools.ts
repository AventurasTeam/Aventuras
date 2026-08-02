import type { InjectionMode } from '@/lib/db'

import { matchTerms } from './name-index'
import type { QueryAll } from './types'

export type EntityRow = {
  id: string
  kind: 'character' | 'location' | 'item' | 'faction'
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

  // Canon seats the location as its own floor row; listing it here too would
  // seat one entity twice.
  const sceneEntities = input.entities.filter(
    (e) => e.status === 'active' && scene.has(e.id) && e.id !== currentLocation?.id,
  )
  const activeThreads = input.threads.filter((t) => t.status === 'active')

  const seatedIds = new Set<string>([
    ...sceneEntities.map((e) => e.id),
    ...(currentLocation ? [currentLocation.id] : []),
    ...activeThreads.map((t) => t.id),
  ])

  // 'always' is a user-intent override across entities / lore / threads. Lore
  // takes no already-seated check because no other floor row can hold a lore
  // row, so it cannot be listed twice.
  const alwaysEntities = input.entities.filter(
    (e) => e.injectionMode === 'always' && !seatedIds.has(e.id),
  )
  const alwaysLore = input.lore.filter((l) => l.injectionMode === 'always')
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

// name-index.ts stores its terms this way; matchTerms compares against an
// NFC-normalized haystack, so an NFD name would otherwise never match.
const term = (s: string): string => s.trim().toLowerCase().normalize('NFC')

/**
 * retrieval.md → Three-sub-pool entity model: active off-scene, staged, and
 * retired only via injection_mode='always'. The retired branch below fires
 * only for a caller passing a floor narrower than buildStructuralFloor's,
 * which seats every always row itself.
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
      staged.map((r) => term(r.name)),
    ),
  )
  const suppressedIds = new Set(staged.filter((r) => hits.has(term(r.name))).map((r) => r.id))

  return rows.filter((r) => {
    if (input.floorIds.has(r.id)) return false
    if (r.injectionMode === 'disabled') return false
    if (r.status === 'retired') return r.injectionMode === 'always'
    if (suppressedIds.has(r.id)) return false
    return true
  })
}

/** Active threads are structural; pending / resolved / failed rank, by mode. */
export function filterThreadPool(
  rows: readonly ThreadRow[],
  floorIds: ReadonlySet<string>,
): ThreadRow[] {
  return rows.filter(
    (r) => !floorIds.has(r.id) && r.status !== 'active' && r.injectionMode !== 'disabled',
  )
}

/** One KNN row's identity. `distance` is carried for logging, never scored. */
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

export type AwarenessRow = {
  id: string
  happeningId: string
  characterId: string
  learnedAtEntryId: string | null
  decayResistance: number | null
  source: string | null
}

/**
 * retrieval.md → POV-awareness scope: the UNION of all in-scene characters'
 * awareness rows in both modes, not lead-only. Detached-POV moments need the
 * wider scope; the `narration` setting is the lever for POV constraint via
 * prompt, not retrieval.
 */
export async function loadAwarenessForScene(
  queryAll: QueryAll,
  branchId: string,
  sceneCharacterIds: readonly string[],
): Promise<AwarenessRow[]> {
  if (sceneCharacterIds.length === 0) return []
  const placeholders = sceneCharacterIds.map(() => '?').join(', ')
  const rows = await queryAll(
    `SELECT id, happening_id, character_id, learned_at_entry_id, decay_resistance, source
     FROM happening_awareness
     WHERE branch_id = ? AND character_id IN (${placeholders})`,
    [branchId, ...sceneCharacterIds],
  )
  return rows.map((r) => {
    const [id, happeningId, characterId, learnedAtEntryId, decayResistance, source] = r as [
      string,
      string,
      string,
      string | null,
      number | null,
      string | null,
    ]
    return { id, happeningId, characterId, learnedAtEntryId, decayResistance, source }
  })
}
