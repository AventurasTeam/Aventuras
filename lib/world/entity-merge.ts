import type { FlagClearPatch, FlagRepointPatch, PipelineAction } from '@/lib/actions'
import type { CollisionReason, Entity, EntityState, ItemState } from '@/lib/db'

import { FLAG_CLEAR, withFlagWrites, type FlagWrite } from './collision-flags'
import { pairSideOf, stillPaired, type CollisionPair, type PairSide } from './collision-pair'
import { sameList } from './draft-text'
import { tailSceneActions, type DeleteTail } from './entity-delete'
import { stateOf } from './entity-draft'
import { itemHasPosition, stateWithRefRewritten } from './entity-refs'
import { canonicalRefsCleared, mergeLinks, type MergeLinkInput } from './merge-links'
import { mergedTerms, type MergeDeselections, type MergedTerms } from './merge-terms'

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

/** The merged canonical's terms, and the canonical as the pair rule reads it after the merge. */
type Merged = {
  /** The merged row takes the loser's name: the one place the merge decides it. */
  nameFromOther: boolean
  terms: MergedTerms
  side: PairSide
}

/** `row` as the flag rules read it once the merge lands: its refs rewritten as the merge writes them. */
function postMergeSide(input: MergeContext, row: Entity): PairSide {
  const state = stateWithRefRewritten(row, input.loser.id, refTarget(input))
  return pairSideOf(state == null ? row : { ...row, state })
}

function mergedRow(input: MergeContext): Merged {
  const { canonical, loser } = input
  const nameFromOther = input.fromLoser.includes('name') && loser.name !== canonical.name
  const terms = mergedTerms(
    { canonical, other: loser },
    {
      deselectedTags: input.deselectedTags,
      deselectedKeywords: input.deselectedKeywords,
      nameFromOther,
    },
  )
  return {
    nameFromOther,
    terms,
    side: {
      ...postMergeSide(input, canonical),
      name: nameFromOther ? loser.name : canonical.name,
      keywords: terms.keywords,
    },
  }
}

/**
 * world.md → Reversibility, judged against the merged row as it stands after the merge: the
 * canonical's flag stays on a live row other than the loser that it still pairs with under its own
 * reason; else it takes the loser's partner and reason if that is a live row other than itself the
 * merged row pairs with under the loser's reason; else it clears.
 */
function canonicalFlagPatch(
  input: MergeContext,
  merged: PairSide,
): FlagClearPatch | FlagRepointPatch | null {
  const { canonical, loser, branchEntities } = input
  const partnerId = canonical.nameCollisionPartnerId
  if (partnerId == null) return null
  const pairsWith = (id: string, reason: CollisionReason) => {
    const row = branchEntities.find((e) => e.id === id)
    return row != null && stillPaired(reason, merged, postMergeSide(input, row))
  }
  const ownReason = canonical.nameCollisionReason
  if (partnerId !== loser.id && ownReason != null && pairsWith(partnerId, ownReason)) return null
  const inherited = loser.nameCollisionPartnerId
  const reason = loser.nameCollisionReason
  if (
    inherited != null &&
    reason != null &&
    inherited !== canonical.id &&
    pairsWith(inherited, reason)
  )
    return { nameCollisionPartnerId: inherited, nameCollisionReason: reason }
  return FLAG_CLEAR
}

function canonicalPatch(input: MergeContext, merged: Merged): EntityPatch {
  const { canonical, loser } = input
  const scalars: Partial<Pick<Entity, MergeScalar>> = {}
  for (const field of input.fromLoser) {
    const takes = field === 'name' ? merged.nameFromOther : loser[field] !== canonical[field]
    if (takes) takeScalar(scalars, field, loser)
  }
  const { tags, keywords } = merged.terms
  const rewritten = canonicalRefsCleared(canonical, loser.id)
  const state = adoptedPlacement(input, rewritten) ?? rewritten
  const columns: EntityPatch = {
    ...scalars,
    ...(sameList(tags, canonical.tags) ? {} : { tags }),
    ...(sameList(keywords, canonical.keywords) ? {} : { keywords }),
    ...(state == null ? {} : { state }),
  }
  const flag = canonicalFlagPatch(input, merged.side)
  return flag == null ? columns : { ...columns, ...flag }
}

/**
 * world.md → Reversibility: another row's flag on the loser re-points at the canonical; on either,
 * it clears once that row and the merged canonical no longer pair under the row's reason (a flag
 * with no reason never holds), both read as they stand after the merge.
 */
function otherFlagWrites(input: MergeContext, merged: PairSide): FlagWrite[] {
  const { canonical, loser, branchEntities } = input
  const writes: FlagWrite[] = []
  for (const row of branchEntities) {
    const partnerId = row.nameCollisionPartnerId
    const reason = row.nameCollisionReason
    if (row.id === canonical.id || row.id === loser.id) continue
    if (partnerId !== loser.id && partnerId !== canonical.id) continue
    if (reason == null || !stillPaired(reason, postMergeSide(input, row), merged))
      writes.push({ id: row.id, clear: true })
    else if (partnerId === loser.id) writes.push({ id: row.id, partnerId: canonical.id })
  }
  return writes
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
 * A canonical item with no position takes the loser's placement, so the merged item keeps whichever
 * position either side had. A held loser needs nothing here: its holders move through `refTarget`.
 */
function adoptedPlacement(input: MergeContext, rewritten: EntityState | null): EntityState | null {
  const { canonical, loser } = input
  if (canonical.kind !== 'item' || refTarget(input) !== canonical.id) return null
  const at = stateOf(loser, 'item').at_location_id
  if (at == null) return null
  const base = (rewritten as ItemState | null) ?? stateOf(canonical, 'item')
  return { ...base, at_location_id: at }
}

/**
 * world.md → Merge, the tail scene. Each effect folds into the canonical's patch when that already
 * writes the column: a group writes a row once.
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
  // Tracked only when it takes the loser's seat, and to a known location: a canonical the scene
  // already held keeps its own, which may be a manual edit.
  const location = tail.currentLocationId
  const joins = !tail.sceneEntities.includes(canonical.id)
  if (canonical.kind === 'character' && joins && location != null) {
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
  const merged = mergedRow(input)
  const tail = tailSceneActions(branchId, input.tail, loser.id, canonical.id)
  const scene = withSceneEffects(input, canonicalPatch(input, merged), tail.length > 0)
  const updates: PipelineAction[] = []

  if (Object.keys(scene.patch).length > 0)
    updates.push(updateEntity(branchId, canonical.id, scene.patch))

  const target = refTarget(input)
  for (const other of input.branchEntities) {
    if (other.id === canonical.id || other.id === loser.id) continue
    const state = stateWithRefRewritten(other, loser.id, target)
    if (state != null) updates.push(updateEntity(branchId, other.id, { state }))
  }
  const actions = withFlagWrites(updates, branchId, otherFlagWrites(input, merged.side))

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
