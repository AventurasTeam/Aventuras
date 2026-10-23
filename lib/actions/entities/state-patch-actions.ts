import { and, eq } from 'drizzle-orm'

import {
  emptyEntityState,
  entities,
  entityStateColumnSchema,
  type CharacterState,
  type Delta,
  type Entity,
  type EntityState,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { newTerms, normalizeTerm } from '@/lib/keyword-terms'
import { entitiesStore } from '@/lib/stores'
import {
  characterFactionId,
  checkParentChain,
  PARENT_CHAIN_BROKEN,
  PARENT_CYCLE,
  parentOfLocations,
  PLACE_REFUSAL,
  placementOf,
  realPlacementOf,
  samePlacement,
  stateOf,
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
  wrotePath,
  wrotePlacement,
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
    wroteColumn(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId), 'status')
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
    wroteColumn(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId), 'status')
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

const placeRefusal = (reason: string): HandlerOutcome => ({
  status: 'rejected',
  reason,
  code: 'noop',
})

/**
 * data-model.md → LocationState shape: writes the parent and the flag together as the row's whole
 * state, so placing clears `unplaced`. Every placement refusal is a noop: a machine writer plans
 * the same checks first, and a refusal that reached the orchestrator unmarked would fail its run.
 */
export const placeLocationHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'placeLocation')
    throw new Error(`handler/kind mismatch: expected 'placeLocation', got '${action.kind}'`)
  const { branchId: bid, id, placement, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return placeRefusal(`place target entities ${bid}:${id} not found`)
  if (current.kind !== 'location') return placeRefusal('not-a-location')
  const stored = placementOf(current)
  if (samePlacement(stored, placement)) return placeRefusal('placement-unchanged')

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
    if (realPlacementOf(places)(id).kind !== 'unplaced') return placeRefusal('not-unplaced')
  } else {
    const parent = places.find((p) => p.id === placement.parentId)
    if (parent === undefined) return placeRefusal('parent-not-a-place')
    if (parent.status === 'retired') return placeRefusal(PLACE_REFUSAL.retiredParent)
    const check = checkParentChain(id, placement.parentId, parentOfLocations(places))
    if (check === 'cycle') return placeRefusal(PARENT_CYCLE)
    if (check === 'cap-hit') {
      logger.error('action_layer.parent_chain_cap_hit', {
        branchId: bid,
        id,
        parentId: placement.parentId,
      })
      return placeRefusal(PARENT_CHAIN_BROKEN)
    }
  }
  if (
    proseEntryId !== null &&
    wrotePlacement(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
  )
    return placeRefusal(USER_EDITED_SINCE_PROSE)
  const next = withPlacement(stateOf(current, 'location'), placement)
  return stateWriteOutcome(bid, id, current, next, ctx)
}
