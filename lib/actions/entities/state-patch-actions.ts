import { and, eq } from 'drizzle-orm'

import {
  entities,
  entityStateColumnSchema,
  type CharacterState,
  type Entity,
  type EntityState,
} from '@/lib/db'
import { entitiesStore } from '@/lib/stores'

import { computeUndoPayload } from '../delta/delta-encoding'
import type { ActionHandler } from '../delta/registry'
import type { DbCtx, DeltaSource } from '../types'

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
      payload: { branchId: string; id: string }
    }
  }
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
  const mergedState = { ...(current.state as Record<string, unknown>) } as Record<string, unknown>
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

  const undoPayload = {
    state: computeUndoPayload(
      entityStateColumnSchema,
      current.state as Record<string, unknown>,
      mergedState,
    ),
  }
  if (Object.keys(undoPayload.state).length === 0) {
    return {
      status: 'rejected' as const,
      reason: `no-op state patch for entities ${branchId}:${id}`,
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
        .set({ state: mergedState as EntityState })
        .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update' as const, id, columns: { state: mergedState } },
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
  return buildStatePatchOutcome(bid, id, current, { stackables }, ctx)
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
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `promote target entities ${bid}:${id} not found` }
  const storeEntity = entitiesStore.getById(id)
  if (current.status !== 'staged' || (storeEntity !== undefined && storeEntity.status !== 'staged'))
    return { status: 'rejected', reason: 'not-staged', code: 'noop' }
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
