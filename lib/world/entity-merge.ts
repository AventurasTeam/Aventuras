import type { FlagClearPatch, FlagRepointPatch, PipelineAction } from '@/lib/actions'
import type { Entity, EntityState, ItemState } from '@/lib/db'

import { FLAG_CLEAR, withFlagWrites, type FlagWrite } from './collision-flags'
import type { CollisionPair } from './collision-pair'
import { sameList } from './draft-text'
import { tailSceneActions, type DeleteTail } from './entity-delete'
import { stateOf } from './entity-draft'
import { itemHasPosition, stateWithRefRewritten } from './entity-refs'
import { canonicalRefsCleared, mergeLinks, type MergeLinkInput } from './merge-links'
import { mergedTerms, type MergeDeselections, type MergedTerms } from './merge-terms'
import { namesakeBasis, type NamesakeSide } from './namesakes'

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

/** The merged canonical's terms, and its name and keywords as the namesake rule reads them. */
type Merged = {
  /** The merged row takes the loser's name: the one place the merge decides it. */
  nameFromOther: boolean
  terms: MergedTerms
  side: NamesakeSide
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
    side: { name: nameFromOther ? loser.name : canonical.name, keywords: terms.keywords },
  }
}

/**
 * world.md → Reversibility: the canonical's flag stays when it names a live namesake of the merged
 * row other than the loser. Otherwise (its partner was the loser, is gone, or no longer matches) it
 * takes over the loser's partner when that is a live namesake of the merged row other than the
 * canonical, keeping its own reason; else it clears.
 */
function canonicalFlagPatch(
  input: MergeContext,
  merged: NamesakeSide,
): FlagClearPatch | FlagRepointPatch | null {
  const { canonical, loser, branchEntities } = input
  const partnerId = canonical.nameCollisionPartnerId
  if (partnerId == null) return null
  const liveNamesake = (id: string) => {
    const row = branchEntities.find((e) => e.id === id)
    return row != null && namesakeBasis(merged, row) != null
  }
  if (partnerId !== loser.id && liveNamesake(partnerId)) return null
  const inherited = loser.nameCollisionPartnerId
  if (inherited != null && inherited !== canonical.id && liveNamesake(inherited))
    return { nameCollisionPartnerId: inherited }
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
 * world.md → Reversibility: another row's flag on the loser re-points at the canonical, and one on
 * either clears once the row and the merged canonical aren't namesakes.
 */
function otherFlagWrites(input: MergeContext, merged: NamesakeSide): FlagWrite[] {
  const { canonical, loser, branchEntities } = input
  const writes: FlagWrite[] = []
  for (const row of branchEntities) {
    const partnerId = row.nameCollisionPartnerId
    if (row.id === canonical.id || row.id === loser.id) continue
    if (partnerId !== loser.id && partnerId !== canonical.id) continue
    if (namesakeBasis(row, merged) == null) writes.push({ id: row.id, clear: true })
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
