import { and, eq } from 'drizzle-orm'

import {
  emptyEntityState,
  entities,
  entityStateColumnSchema,
  type CharacterState,
  type CollisionReason,
  type Delta,
  type Entity,
  type EntityState,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { newTerms, normalizeTerm } from '@/lib/keyword-terms'
import { boundStateText } from '@/lib/piggyback'
import { entitiesStore } from '@/lib/stores'
import {
  characterFactionId,
  checkParentChain,
  PARENT_CHAIN_BROKEN,
  PARENT_CYCLE,
  parentOfLocations,
  pairSideOf,
  PLACE_REFUSAL,
  placementOf,
  realPlacementOf,
  samePlacement,
  stateOf,
  stillPaired,
  withPlacement,
} from '@/lib/world'

import { computeUndoPayload } from '../delta/delta-encoding'
import {
  createdKey,
  type ActionHandler,
  type GroupScope,
  type HandlerOutcome,
} from '../delta/registry'
import {
  USER_EDITED_SINCE_PROSE,
  userEditsSinceProse,
  wroteColumn,
  wroteCollisionFlag,
  wrotePath,
  wrotePlacement,
  wroteRetirement,
} from '../delta/user-precedence'
import type { DbCtx, DeltaSource, ProseEntryId } from '../types'

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    updateEntityVisualState: {
      source: DeltaSource
      payload: { branchId: string; id: string; visual: Partial<CharacterState['visual']> }
    }
    updateEntityInventory: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        equipped_items?: string[]
        inventory?: string[]
      }
    }
    updateEntityStackables: {
      source: DeltaSource
      payload: { branchId: string; id: string; stackables: Record<string, number> }
    }
    updateItemPosition: {
      source: DeltaSource
      payload: { branchId: string; id: string; atLocationId: string | null }
    }
    updateEntityCondition: {
      source: DeltaSource
      payload: { branchId: string; id: string; condition: string }
    }
    updateEntityLocationTracking: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        currentLocationId?: string | null
        lastSeenAt?: { entryId: string; locationId: string | null; worldTime: number } | null
      }
    }
    promoteStagedEntity: {
      source: DeltaSource
      payload: { branchId: string; id: string; proseEntryId: ProseEntryId }
    }
    appendEntityKeywords: {
      source: DeltaSource
      payload: { branchId: string; id: string; keywords: string[]; proseEntryId: ProseEntryId }
    }
    retireEntity: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        retiredReason: string | null
        proseEntryId: ProseEntryId
      }
    }
    setCharacterFaction: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        /** Null clears the membership. */
        factionId: string | null
        proseEntryId: ProseEntryId
      }
    }
    renameEntity: {
      source: DeltaSource
      payload: { branchId: string; id: string; name: string; proseEntryId: ProseEntryId }
    }
    raiseCollisionFlag: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        partnerId: string
        reason: CollisionReason
        proseEntryId: ProseEntryId
      }
    }
    setFactionStanding: {
      source: DeltaSource
      payload: { branchId: string; id: string; standing: string; proseEntryId: ProseEntryId }
    }
    returnFromRetirement: {
      source: DeltaSource
      payload: { branchId: string; id: string; proseEntryId: ProseEntryId }
    }
    placeLocation: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        /** `top` only for an unplaced place (data-model.md → Authorship contract). */
        placement: { kind: 'under'; parentId: string } | { kind: 'top' }
        /** Null skips user precedence: the per-turn writer's prose is always newer. */
        proseEntryId: ProseEntryId
      }
    }
  }
}

// Matched only against terms the live list lacks, so a hit is one the user removed.
function priorTerms(edits: readonly Delta[]): Set<string> {
  const terms = new Set<string>()
  for (const edit of edits) {
    const prior = edit.undoPayload?.keywords
    if (!Array.isArray(prior)) continue
    for (const term of prior) if (typeof term === 'string') terms.add(normalizeTerm(term))
  }
  return terms
}

async function loadCurrent(branchId: string, id: string, ctx: DbCtx): Promise<Entity | undefined> {
  const [current] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
  return current
}

function buildStatePatchOutcome(
  branchId: string,
  id: string,
  current: Entity,
  topLevelPatch: Record<string, unknown>,
  ctx: DbCtx,
) {
  const mergedState: Record<string, unknown> = { ...priorState(current) }
  for (const [key, value] of Object.entries(topLevelPatch)) {
    if (key === 'visual' && typeof value === 'object' && value !== null) {
      mergedState.visual = {
        ...(mergedState.visual as Record<string, unknown> | undefined),
        ...value,
      }
    } else {
      mergedState[key] = value
    }
  }
  return stateWriteOutcome(branchId, id, current, mergedState, ctx)
}

// A null column reads as the empty state, as updateEntity's does.
function priorState(current: Entity): Record<string, unknown> {
  return (current.state ?? emptyEntityState(current.kind)) as Record<string, unknown>
}

/** Writes `next` as the row's whole state: a key `next` lacks is gone from the row. */
function stateWriteOutcome(
  branchId: string,
  id: string,
  current: Entity,
  next: Record<string, unknown>,
  ctx: DbCtx,
): HandlerOutcome {
  const undoPayload = {
    state: computeUndoPayload(entityStateColumnSchema, priorState(current), next),
  }
  if (Object.keys(undoPayload.state).length === 0) {
    // 'noop', not a plain rejection: a model restating an entity's current state
    // is well-formed and merely redundant, and an unmarked rejection reverses the
    // user's whole turn (orchestrator handleEvent).
    return {
      status: 'rejected' as const,
      reason: `no-op state patch for entities ${branchId}:${id}`,
      code: 'noop' as const,
    }
  }

  return {
    status: 'ok' as const,
    targetTable: 'entities',
    targetId: id,
    op: 'update' as const,
    undoPayload,
    ops: [
      ctx.db
        .update(entities)
        .set({ state: next as EntityState })
        .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update' as const, id, columns: { state: next } },
  }
}

// buildStatePatchOutcome merges without parsing, and these fields belong to characters only.
function refuseNonCharacter(kind: string, current: Entity): HandlerOutcome | null {
  if (current.kind === 'character') return null
  return {
    status: 'rejected',
    reason: `${kind} target ${current.branchId}:${current.id} is not a character`,
  }
}

export const updateEntityVisualStateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityVisualState')
    throw new Error(
      `handler/kind mismatch: expected 'updateEntityVisualState', got '${action.kind}'`,
    )
  const { branchId: bid, id, visual } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  return buildStatePatchOutcome(bid, id, current, { visual }, ctx)
}

export const updateEntityInventoryHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityInventory')
    throw new Error(`handler/kind mismatch: expected 'updateEntityInventory', got '${action.kind}'`)
  const { branchId: bid, id, equipped_items, inventory } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  const patch: Record<string, unknown> = {}
  if (equipped_items !== undefined) patch.equipped_items = equipped_items
  if (inventory !== undefined) patch.inventory = inventory
  if (Object.keys(patch).length === 0)
    return {
      status: 'rejected',
      reason: `updateEntityInventory payload for ${bid}:${id} touches no field`,
    }
  return buildStatePatchOutcome(bid, id, current, patch, ctx)
}

export const updateEntityStackablesHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityStackables')
    throw new Error(
      `handler/kind mismatch: expected 'updateEntityStackables', got '${action.kind}'`,
    )
  const { branchId: bid, id, stackables } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  return buildStatePatchOutcome(bid, id, current, { stackables }, ctx)
}

export const updateItemPositionHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateItemPosition')
    throw new Error(`handler/kind mismatch: expected 'updateItemPosition', got '${action.kind}'`)
  const { branchId: bid, id, atLocationId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  if (current.kind !== 'item')
    return { status: 'rejected', reason: `updateItemPosition target ${bid}:${id} is not an item` }
  return buildStatePatchOutcome(bid, id, current, { at_location_id: atLocationId }, ctx)
}

/**
 * A place's or item's condition, replaced whole and bounded as a visual value is. Checks no
 * precedence: the per-turn writer's prose is always newer than a user edit (cadence.md).
 */
export const updateEntityConditionHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityCondition')
    throw new Error(`handler/kind mismatch: expected 'updateEntityCondition', got '${action.kind}'`)
  const { branchId: bid, id, condition } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return {
      status: 'rejected',
      reason: `condition target entities ${bid}:${id} not found`,
      code: 'noop',
    }
  if (current.kind !== 'location' && current.kind !== 'item')
    return { status: 'rejected', reason: 'not-a-place-or-item', code: 'noop' }
  return buildStatePatchOutcome(
    bid,
    id,
    current,
    { condition: boundStateText(condition).text },
    ctx,
  )
}

export const updateEntityLocationTrackingHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityLocationTracking')
    throw new Error(
      `handler/kind mismatch: expected 'updateEntityLocationTracking', got '${action.kind}'`,
    )
  const { branchId: bid, id, currentLocationId, lastSeenAt } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  const patch: Record<string, unknown> = {}
  if (currentLocationId !== undefined) patch.current_location_id = currentLocationId
  if (lastSeenAt !== undefined) patch.lastSeenAt = lastSeenAt
  if (Object.keys(patch).length === 0)
    return {
      status: 'rejected',
      reason: `updateEntityLocationTracking payload for ${bid}:${id} touches no field`,
    }
  return buildStatePatchOutcome(bid, id, current, patch, ctx)
}

export const promoteStagedEntityHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'promoteStagedEntity')
    throw new Error(`handler/kind mismatch: expected 'promoteStagedEntity', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return {
      status: 'rejected',
      reason: `promote target entities ${bid}:${id} not found`,
      code: 'noop',
    }
  const storeEntity = entitiesStore.getById(id)
  if (current.status !== 'staged' || (storeEntity !== undefined && storeEntity.status !== 'staged'))
    return { status: 'rejected', reason: 'not-staged', code: 'noop' }
  if (
    proseEntryId !== null &&
    wroteRetirement(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
  )
    return { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload: { status: current.status },
    ops: [
      ctx.db
        .update(entities)
        .set({ status: 'active' })
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: { status: 'active' } },
  }
}

/**
 * Appends only the payload terms the row lacks as the write lands (cadence.md → User edits and
 * classifier writes); with `proseEntryId`, a term the user removed after that prose stays removed.
 */
export const appendEntityKeywordsHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'appendEntityKeywords')
    throw new Error(`handler/kind mismatch: expected 'appendEntityKeywords', got '${action.kind}'`)
  const { branchId: bid, id, keywords, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return {
      status: 'rejected',
      reason: `keyword target entities ${bid}:${id} not found`,
      code: 'noop',
    }
  let added = newTerms(current.keywords, keywords)
  if (added.length === 0) return { status: 'rejected', reason: 'no-new-keywords', code: 'noop' }
  if (proseEntryId !== null) {
    const removed = priorTerms(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
    added = added.filter((term) => !removed.has(normalizeTerm(term)))
    if (added.length === 0)
      return { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }
  }
  const next = [...current.keywords, ...added]
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload: { keywords: current.keywords },
    ops: [
      ctx.db
        .update(entities)
        .set({ keywords: next })
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: { keywords: next } },
  }
}

/** active → retired only, checked as the write lands, so a user-moved row keeps its status. */
export const retireEntityHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'retireEntity')
    throw new Error(`handler/kind mismatch: expected 'retireEntity', got '${action.kind}'`)
  const { branchId: bid, id, retiredReason, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return {
      status: 'rejected',
      reason: `retire target entities ${bid}:${id} not found`,
      code: 'noop',
    }
  if (current.status !== 'active') return { status: 'rejected', reason: 'not-active', code: 'noop' }
  // Only the user retires a place (classifier.md → What the classifier writes).
  if (current.kind === 'location') return { status: 'rejected', reason: 'location', code: 'noop' }
  if (
    proseEntryId !== null &&
    wroteRetirement(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
  )
    return { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }
  const columns = { status: 'retired' as const, retiredReason }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload: { status: current.status, retiredReason: current.retiredReason },
    ops: [
      ctx.db
        .update(entities)
        .set(columns)
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns },
  }
}

async function isFaction(
  ctx: DbCtx,
  branchId: string,
  id: string,
  group: GroupScope | undefined,
): Promise<boolean> {
  if (group?.created.has(createdKey('entities', id))) return true
  const [row] = await ctx.db
    .select({ kind: entities.kind })
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
  return row?.kind === 'faction'
}

/** cadence.md → User edits and classifier writes: `state.faction_id` alone, against the live row. */
export const setCharacterFactionHandler: ActionHandler = async (action, branchId, ctx, group) => {
  if (action.kind !== 'setCharacterFaction')
    throw new Error(`handler/kind mismatch: expected 'setCharacterFaction', got '${action.kind}'`)
  const { branchId: bid, id, factionId, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return {
      status: 'rejected',
      reason: `faction target entities ${bid}:${id} not found`,
      code: 'noop',
    }
  if (current.kind !== 'character')
    return { status: 'rejected', reason: 'not-a-character', code: 'noop' }
  if (characterFactionId(current) === factionId)
    return { status: 'rejected', reason: 'faction-unchanged', code: 'noop' }
  if (factionId !== null && !(await isFaction(ctx, bid, factionId, group)))
    return { status: 'rejected', reason: 'not-a-faction', code: 'noop' }
  if (
    proseEntryId !== null &&
    wrotePath(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId), 'state', [
      'faction_id',
    ])
  )
    return { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }
  return buildStatePatchOutcome(bid, id, current, { faction_id: factionId }, ctx)
}

const noopRefusal = (reason: string): HandlerOutcome => ({
  status: 'rejected',
  reason,
  code: 'noop',
})

/**
 * data-model.md → LocationState shape: parent and `unplaced` flag written as the row's whole state.
 * Refusals are all noops: a machine writer plans the same checks; an unmarked one fails its run.
 */
export const placeLocationHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'placeLocation')
    throw new Error(`handler/kind mismatch: expected 'placeLocation', got '${action.kind}'`)
  const { branchId: bid, id, placement, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`place target entities ${bid}:${id} not found`)
  if (current.kind !== 'location') return noopRefusal('not-a-location')
  const stored = placementOf(current)
  if (samePlacement(stored, placement)) return noopRefusal('placement-unchanged')

  const places = await ctx.db
    .select({
      id: entities.id,
      kind: entities.kind,
      state: entities.state,
      status: entities.status,
    })
    .from(entities)
    .where(and(eq(entities.branchId, bid), eq(entities.kind, 'location')))
  if (placement.kind === 'top') {
    if (realPlacementOf(places)(id).kind !== 'unplaced') return noopRefusal('not-unplaced')
  } else {
    const parent = places.find((p) => p.id === placement.parentId)
    if (parent === undefined) return noopRefusal('parent-not-a-place')
    if (parent.status === 'retired') return noopRefusal(PLACE_REFUSAL.retiredParent)
    const check = checkParentChain(id, placement.parentId, parentOfLocations(places))
    if (check === 'cycle') return noopRefusal(PARENT_CYCLE)
    if (check === 'cap-hit') {
      logger.error('action_layer.parent_chain_cap_hit', {
        branchId: bid,
        id,
        parentId: placement.parentId,
      })
      return noopRefusal(PARENT_CHAIN_BROKEN)
    }
  }
  if (
    proseEntryId !== null &&
    wrotePlacement(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
  )
    return noopRefusal(USER_EDITED_SINCE_PROSE)
  const next = withPlacement(stateOf(current, 'location'), placement)
  return stateWriteOutcome(bid, id, current, next, ctx)
}

/**
 * classifier.md → What the classifier writes → Names. The planner has already tested the name
 * against the kind's other rows.
 */
export const renameEntityHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'renameEntity')
    throw new Error(`handler/kind mismatch: expected 'renameEntity', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  const name = action.payload.name.trim()
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`rename target entities ${bid}:${id} not found`)
  if (name === '') return noopRefusal('name-blank')
  // The same name under keyword-term normalization (case, surrounding space) is no reveal.
  if (normalizeTerm(name) === normalizeTerm(current.name)) return noopRefusal('name-unchanged')
  const edits =
    proseEntryId === null ? [] : await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId)
  if (wroteColumn(edits, 'name')) return noopRefusal(USER_EDITED_SINCE_PROSE)
  // The old name joins the keywords unless they hold it, or the user removed it after the prose.
  const removed = priorTerms(edits)
  const kept = newTerms(current.keywords, [current.name]).filter(
    (term) => !removed.has(normalizeTerm(term)),
  )
  // Keywords leave out the name itself (the prompt's New characters rule).
  const others = current.keywords.filter((term) => normalizeTerm(term) !== normalizeTerm(name))
  const changed = kept.length > 0 || others.length !== current.keywords.length
  const keywords = changed ? { keywords: [...others, ...kept] } : {}
  // `name` is an embedded field (KIND_FIELDS.entity), so the row re-embeds.
  const columns = { name, ...keywords, embeddingStale: 1 as const }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload: { name: current.name, ...(changed ? { keywords: current.keywords } : {}) },
    ops: [
      ctx.db
        .update(entities)
        .set(columns)
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns },
  }
}

/** edge-cases.md → Layer B. A row already flagged keeps its partner: one per row. */
export const raiseCollisionFlagHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'raiseCollisionFlag')
    throw new Error(`handler/kind mismatch: expected 'raiseCollisionFlag', got '${action.kind}'`)
  const { branchId: bid, id, partnerId, reason, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`flag target entities ${bid}:${id} not found`)
  if (current.nameCollisionFlag === 1) return noopRefusal('already-flagged')
  if (partnerId === id) return noopRefusal('partner-is-self')
  const partner = await loadCurrent(bid, partnerId, ctx)
  if (partner?.kind !== current.kind) return noopRefusal('partner-not-of-kind')
  // World's pairing rule on the rows as they stand, a clash's keyword landed; World clears others.
  if (!stillPaired(reason, pairSideOf(current), pairSideOf(partner)))
    return noopRefusal('not-namesakes')
  // A user's clear stands against older prose; newer prose may raise the flag again.
  if (
    proseEntryId !== null &&
    wroteCollisionFlag(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
  )
    return noopRefusal(USER_EDITED_SINCE_PROSE)
  const columns = {
    nameCollisionFlag: 1 as const,
    nameCollisionPartnerId: partnerId,
    nameCollisionReason: reason,
  }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload: {
      nameCollisionFlag: current.nameCollisionFlag,
      nameCollisionPartnerId: current.nameCollisionPartnerId,
      nameCollisionReason: current.nameCollisionReason,
    },
    ops: [
      ctx.db
        .update(entities)
        .set(columns)
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns },
  }
}

/** classifier.md → Factions: `state.standing` alone, cut to the schema's 500 as a condition is. */
export const setFactionStandingHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'setFactionStanding')
    throw new Error(`handler/kind mismatch: expected 'setFactionStanding', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  const bounded = boundStateText(action.payload.standing).text
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`standing target entities ${bid}:${id} not found`)
  if (current.kind !== 'faction') return noopRefusal('not-a-faction')
  if (stateOf(current, 'faction').standing === bounded) return noopRefusal('standing-unchanged')
  if (
    proseEntryId !== null &&
    wrotePath(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId), 'state', [
      'standing',
    ])
  )
    return noopRefusal(USER_EDITED_SINCE_PROSE)
  return buildStatePatchOutcome(bid, id, current, { standing: bounded }, ctx)
}

/**
 * retired → active on a character, checked as the write lands so a status the user wrote since
 * stands; clears the reason as World's un-retire does. Only the user brings back a place.
 */
export const returnFromRetirementHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'returnFromRetirement')
    throw new Error(`handler/kind mismatch: expected 'returnFromRetirement', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`return target entities ${bid}:${id} not found`)
  if (current.kind !== 'character') return noopRefusal('not-a-character')
  if (current.status !== 'retired') return noopRefusal('not-retired')
  if (
    proseEntryId !== null &&
    wroteRetirement(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
  )
    return noopRefusal(USER_EDITED_SINCE_PROSE)
  const columns = { status: 'active' as const, retiredReason: null }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload: { status: current.status, retiredReason: current.retiredReason },
    ops: [
      ctx.db
        .update(entities)
        .set(columns)
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns },
  }
}
