import type { PipelineAction } from '@/lib/actions'
import type { Entity, EntityState, ItemState } from '@/lib/db'

import type { CollisionPair } from './collision-pair'
import { sameList } from './draft-text'
import type { DeleteTail } from './entity-delete'
import { stateOf } from './entity-draft'
import { itemHasPosition, stateWithRefRewritten } from './entity-refs'
import { mergeLinks, type MergeLinkInput } from './merge-links'
import { mergedTerms, type MergeDeselections } from './merge-terms'

export const MERGE_SCALARS = [
  'name',
  'description',
  'status',
  'retiredReason',
  'injectionMode',
  'priority',
] as const
export type MergeScalar = (typeof MERGE_SCALARS)[number]

export type EntityMergeInput = MergeDeselections &
  Omit<MergeLinkInput, 'canonical' | 'loser'> & {
    pair: CollisionPair
    /** The row of `pair` that survives; the other one is the loser. */
    canonicalId: string
    /** Scalars the merged row takes from the loser; every other one keeps the canonical's. */
    fromLoser: readonly MergeScalar[]
    tail: DeleteTail | null
    newId: (prefix: string) => string
  }

type MergeContext = Omit<EntityMergeInput, 'pair' | 'canonicalId'> & {
  canonical: Entity
  loser: Entity
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

function canonicalPatch(input: MergeContext): EntityPatch {
  const { canonical, loser } = input
  const scalars: Partial<Pick<Entity, MergeScalar>> = {}
  for (const field of input.fromLoser) {
    if (loser[field] !== canonical[field]) takeScalar(scalars, field, loser)
  }
  const { tags, keywords } = mergedTerms({ canonical, other: loser }, input)
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
 * ItemState shape): a held or placed canonical keeps its own; the loser's holders drop it.
 */
function refTarget({ canonical, branchEntities }: MergeContext): string | null {
  return canonical.kind === 'item' && itemHasPosition(canonical, branchEntities)
    ? null
    : canonical.id
}

/**
 * A canonical item with no position takes the loser's placement, so a merge never leaves the item
 * nowhere. A held loser needs nothing here: its holders move to the canonical through `refTarget`.
 */
function adoptedPlacement(input: MergeContext, rewritten: EntityState | null): EntityState | null {
  const { canonical, loser } = input
  if (canonical.kind !== 'item' || refTarget(input) !== canonical.id) return null
  const at = stateOf(loser, 'item').at_location_id
  if (at == null) return null
  const base = (rewritten as ItemState | null) ?? stateOf(canonical, 'item')
  return { ...base, at_location_id: at }
}

/** The loser replaced by the canonical in place, the canonical kept once. */
function sceneWithCanonical(scene: readonly string[], loserId: string, canonicalId: string) {
  const out: string[] = []
  for (const id of scene) {
    const next = id === loserId ? canonicalId : id
    if (next === canonicalId && out.includes(canonicalId)) continue
    out.push(next)
  }
  return out
}

function tailActions(input: MergeContext): PipelineAction[] {
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

/**
 * world.md → Merge, the tail scene: a canonical the merge seats in the tail is promoted when its
 * merged status is staged and, for a character, tracked to the tail's location. Each folds into the
 * canonical's patch when that already writes the column, since a group writes a row once.
 */
function withSceneEffects(
  input: MergeContext,
  patch: EntityPatch,
  seated: boolean,
): { patch: EntityPatch; actions: PipelineAction[] } {
  const { branchId, canonical, tail } = input
  const actions: PipelineAction[] = []
  if (!seated || tail == null) return { patch, actions }
  let next = patch
  if ((next.status ?? canonical.status) === 'staged') {
    if (next.status === undefined)
      actions.push({
        kind: 'promoteStagedEntity',
        source: 'user_edit',
        payload: { branchId, id: canonical.id, proseEntryId: null },
      })
    else next = { ...next, status: 'active' }
  }
  // Tracked only to a known location: a null one leaves the canonical where it was.
  const location = tail.currentLocationId
  if (canonical.kind === 'character' && location != null) {
    if (next.state == null)
      actions.push({
        kind: 'updateEntityLocationTracking',
        source: 'user_edit',
        payload: { branchId, id: canonical.id, currentLocationId: location },
      })
    else
      next = {
        ...next,
        state: { ...stateOf({ state: next.state }, 'character'), current_location_id: location },
      }
  }
  return { patch: next, actions }
}

function mergeContext({ pair, canonicalId, ...rest }: EntityMergeInput): MergeContext {
  const [first, second] = pair
  if (canonicalId !== first.id && canonicalId !== second.id)
    throw new Error(`entityMergeActions: ${canonicalId} is not in the pair`)
  const canonical = canonicalId === first.id ? first : second
  const loser = canonical === first ? second : first
  const { branchId, branchEntities } = rest
  if (canonical.branchId !== branchId)
    throw new Error(`entityMergeActions: ${canonical.id} and ${loser.id} not both on ${branchId}`)
  const ids = new Set(branchEntities.map((e) => e.id))
  if (!ids.has(canonical.id) || !ids.has(loser.id))
    throw new Error('entityMergeActions: the pair is not among the branch entities')
  return { ...rest, canonical, loser }
}

/**
 * world.md → Merge. The loser's link rows are re-created on the canonical and its `deleteEntity`
 * cascades the originals: no arm re-keys a link row, and the group runner refuses writes to them.
 */
export function entityMergeActions(request: EntityMergeInput): PipelineAction[] {
  const input = mergeContext(request)
  const { branchId, canonical, loser, newId } = input
  const { moved } = mergeLinks(input)
  const tail = tailActions(input)
  const scene = withSceneEffects(input, canonicalPatch(input), tail.length > 0)
  const actions: PipelineAction[] = []

  if (Object.keys(scene.patch).length > 0)
    actions.push(updateEntity(branchId, canonical.id, scene.patch))

  const target = refTarget(input)
  for (const other of input.branchEntities) {
    if (other.id === canonical.id || other.id === loser.id) continue
    const state = stateWithRefRewritten(other, loser.id, target)
    if (state != null) actions.push(updateEntity(branchId, other.id, { state }))
  }

  for (const row of moved.awareness)
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

  for (const row of moved.involvements)
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

  for (const copy of moved.relationships)
    actions.push({
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId,
        subjectId: canonical.id,
        objectId: copy.otherId,
        kind: copy.kind,
        inverseKind: copy.inverseKind,
      },
    })

  actions.push(...tail)
  actions.push({ kind: 'deleteEntity', source: 'user_edit', payload: { branchId, id: loser.id } })
  actions.push(...scene.actions)
  return actions
}
