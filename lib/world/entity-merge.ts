import type { PipelineAction } from '@/lib/actions'
import type {
  CharacterRelationship,
  Entity,
  EntityState,
  HappeningAwareness,
  HappeningInvolvement,
  ItemState,
} from '@/lib/db'
import { dedupeTerms } from '@/lib/keyword-terms'

import { cleanList, sameList } from './draft-text'
import type { DeleteTail } from './entity-delete'
import { heldItems, stateOf } from './entity-draft'
import { entityLinkRows, stateWithRefRewritten, type EntityLinkRows } from './entity-refs'

export const MERGE_SCALARS = [
  'name',
  'description',
  'status',
  'retiredReason',
  'injectionMode',
  'priority',
] as const
export type MergeScalar = (typeof MERGE_SCALARS)[number]

export type EntityMergeInput = {
  branchId: string
  canonical: Entity
  loser: Entity
  /** Scalars the merged row takes from the loser; every other one keeps the canonical's. */
  fromLoser: readonly MergeScalar[]
  /** Final tags after the user's deselects. */
  tags: readonly string[]
  /** Final keywords; normalized and de-duplicated here (C12). */
  keywords: readonly string[]
  /** The branch's entities, both rows among them. */
  branchEntities: readonly Entity[]
  /** The branch's link rows. */
  awareness: readonly HappeningAwareness[]
  involvements: readonly HappeningInvolvement[]
  relationships: readonly CharacterRelationship[]
  tail: DeleteTail | null
  newId: (prefix: string) => string
}

export type EntityMergePlan = {
  actions: PipelineAction[]
  /** Loser rows the canonical already covers; the cascade removes them (the summary footnote). */
  dropped: { awareness: number; involvements: number }
}

type EntityPatch = Extract<PipelineAction, { kind: 'updateEntity' }>['payload']['patch']

function updateEntity(branchId: string, id: string, patch: EntityPatch): PipelineAction {
  return { kind: 'updateEntity', source: 'user_edit', payload: { branchId, id, patch } }
}

function takeScalar<K extends MergeScalar>(
  patch: Partial<Pick<Entity, MergeScalar>>,
  field: K,
  from: Entity,
): void {
  patch[field] = from[field]
}

function canonicalPatch(input: EntityMergeInput): EntityPatch {
  const { canonical, loser } = input
  const scalars: Partial<Pick<Entity, MergeScalar>> = {}
  for (const field of input.fromLoser) {
    if (loser[field] !== canonical[field]) takeScalar(scalars, field, loser)
  }
  const tags = [...new Set(cleanList(input.tags))]
  const keywords = dedupeTerms(input.keywords)
  const rewritten = stateWithRefRewritten(canonical, loser.id, canonical.id)
  const state = adoptedPlacement(input, rewritten) ?? rewritten
  // Spread, never `nameCollisionFlag: undefined`: the update arm refuses any value but 0.
  return {
    ...scalars,
    ...(sameList(tags, canonical.tags) ? {} : { tags }),
    ...(sameList(keywords, canonical.keywords) ? {} : { keywords }),
    ...(canonical.nameCollisionFlag === 1 ? { nameCollisionFlag: 0 as const } : {}),
    ...(state == null ? {} : { state }),
  }
}

/**
 * Where other rows' refs to the loser go. An item has at most one position (data-model.md →
 * ItemState shape), so a canonical item already held or placed keeps its own and the loser's
 * holders drop it.
 */
function refTarget({ canonical, branchEntities }: EntityMergeInput): string | null {
  if (canonical.kind !== 'item') return canonical.id
  const placed = stateOf(canonical, 'item').at_location_id != null
  const held = branchEntities.some(
    (e) => e.kind === 'character' && heldItems(stateOf(e, 'character')).includes(canonical.id),
  )
  return placed || held ? null : canonical.id
}

/**
 * A canonical item with no position takes the loser's placement, so a merge never leaves the item
 * nowhere (developer decision, 2026-10-06). A held loser needs nothing here: its holders move to
 * the canonical through `refTarget`.
 */
function adoptedPlacement(
  input: EntityMergeInput,
  rewritten: EntityState | null,
): EntityState | null {
  const { canonical, loser } = input
  if (canonical.kind !== 'item' || refTarget(input) !== canonical.id) return null
  const at = stateOf(loser, 'item').at_location_id
  if (at == null) return null
  const base = (rewritten as ItemState | null) ?? stateOf(canonical, 'item')
  return { ...base, at_location_id: at }
}

/** A relationship row seen from `id`: the other end, `id`'s view of it, and its view of `id`. */
function seenFrom(row: CharacterRelationship, id: string) {
  return row.aId === id
    ? { other: row.bId, self: row.kind, their: row.inverseKind }
    : { other: row.aId, self: row.inverseKind, their: row.kind }
}

function relationshipActions(
  input: EntityMergeInput,
  loser: EntityLinkRows,
  canonical: EntityLinkRows,
): PipelineAction[] {
  const { branchId } = input
  const kept = new Map(
    canonical.relationships.map((row) => {
      const view = seenFrom(row, input.canonical.id)
      return [view.other, view] as const
    }),
  )
  const actions: PipelineAction[] = []
  for (const row of loser.relationships) {
    const moved = seenFrom(row, input.loser.id)
    // The pair would name the canonical twice; the cascade removes the row.
    if (moved.other === input.canonical.id) continue
    const existing = kept.get(moved.other)
    const self = existing?.self ?? moved.self
    const their = existing?.their ?? moved.their
    if (existing != null && existing.self === self && existing.their === their) continue
    actions.push({
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId,
        subjectId: input.canonical.id,
        objectId: moved.other,
        kind: self,
        inverseKind: their,
      },
    })
  }
  return actions
}

/** The loser replaced by the canonical in place, keeping the canonical's first place only. */
function sceneWithCanonical(scene: readonly string[], loserId: string, canonicalId: string) {
  const out: string[] = []
  for (const id of scene) {
    const next = id === loserId ? canonicalId : id
    if (next === canonicalId && out.includes(canonicalId)) continue
    out.push(next)
  }
  return out
}

function tailActions(input: EntityMergeInput): PipelineAction[] {
  const { branchId, tail, loser, canonical } = input
  if (tail == null) return []
  const metadata: { sceneEntities?: string[]; currentLocationId?: string } = {}
  if (tail.sceneEntities.includes(loser.id))
    metadata.sceneEntities = sceneWithCanonical(tail.sceneEntities, loser.id, canonical.id)
  if (tail.currentLocationId === loser.id) metadata.currentLocationId = canonical.id
  if (Object.keys(metadata).length === 0) return []
  return [
    {
      kind: 'updateStoryEntryMetadata',
      source: 'user_edit',
      payload: { branchId, id: tail.id, metadata },
    },
  ]
}

function assertMergeable({ branchId, canonical, loser, branchEntities }: EntityMergeInput): void {
  if (canonical.id === loser.id)
    throw new Error(`entityMergeActions: ${loser.id} merged into itself`)
  if (canonical.branchId !== branchId || loser.branchId !== branchId)
    throw new Error(`entityMergeActions: ${canonical.id} and ${loser.id} not both on ${branchId}`)
  if (canonical.kind !== loser.kind)
    throw new Error(`entityMergeActions: ${loser.kind} merged into ${canonical.kind}`)
  const ids = new Set(branchEntities.map((e) => e.id))
  if (!ids.has(canonical.id) || !ids.has(loser.id))
    throw new Error('entityMergeActions: the pair is not among the branch entities')
}

/**
 * world.md → Merge. The loser's link rows are re-created on the canonical and the loser's
 * `deleteEntity` cascades the originals: no arm can re-key a link row, and the group runner refuses
 * a write to a row a delete in it cascades. Every handler reads pre-group state.
 */
export function entityMergeActions(input: EntityMergeInput): EntityMergePlan {
  assertMergeable(input)
  const { branchId, canonical, loser, newId } = input
  const linksOf = (id: string) =>
    entityLinkRows({
      branchId,
      id,
      awareness: input.awareness,
      involvements: input.involvements,
      relationships: input.relationships,
    })
  const loserLinks = linksOf(loser.id)
  const canonicalLinks = linksOf(canonical.id)
  const actions: PipelineAction[] = []
  const dropped = { awareness: 0, involvements: 0 }

  const patch = canonicalPatch(input)
  if (Object.keys(patch).length > 0) actions.push(updateEntity(branchId, canonical.id, patch))

  const target = refTarget(input)
  for (const other of input.branchEntities) {
    if (other.id === canonical.id || other.id === loser.id) continue
    const state = stateWithRefRewritten(other, loser.id, target)
    if (state != null) actions.push(updateEntity(branchId, other.id, { state }))
  }

  const known = new Set(canonicalLinks.awareness.map((row) => row.happeningId))
  for (const row of loserLinks.awareness) {
    if (known.has(row.happeningId)) {
      dropped.awareness += 1
      continue
    }
    actions.push({
      kind: 'upsertHappeningAwareness',
      source: 'user_edit',
      payload: {
        branchId,
        characterId: canonical.id,
        happeningId: row.happeningId,
        learnedAtEntryId: row.learnedAtEntryId,
        decayResistance: row.decayResistance,
        source: row.source,
        retrievalCount: row.retrievalCount,
      },
    })
  }

  const involved = new Set(canonicalLinks.involvements.map((row) => row.happeningId))
  for (const row of loserLinks.involvements) {
    if (involved.has(row.happeningId)) {
      dropped.involvements += 1
      continue
    }
    actions.push({
      kind: 'createHappeningInvolvement',
      source: 'user_edit',
      payload: {
        entry: {
          id: newId('hinv'),
          branchId,
          happeningId: row.happeningId,
          entityId: canonical.id,
          role: row.role,
        },
      },
    })
  }

  actions.push(...relationshipActions(input, loserLinks, canonicalLinks))
  actions.push(...tailActions(input))
  actions.push({ kind: 'deleteEntity', source: 'user_edit', payload: { branchId, id: loser.id } })
  return { actions, dropped }
}
