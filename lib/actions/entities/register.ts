import { and, eq } from 'drizzle-orm'

import type { Entity, EntityState, NewEntity } from '@/lib/db'
import {
  emptyEntityState,
  entities,
  entityStateColumnSchema,
  entityStateSchemaForKind,
  entityWriteSchema,
} from '@/lib/db'
import { entitiesStore } from '@/lib/stores'

import { computeUndoPayload } from '../delta/delta-encoding'
import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type EntityUpdatePatch = Partial<{
  name: string
  description: string | null
  status: Entity['status']
  retiredReason: string | null
  injectionMode: Entity['injectionMode']
  tags: string[]
  state: EntityState
}>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createEntity: { source: DeltaSource; payload: { entry: NewEntity } }
    updateEntity: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: EntityUpdatePatch }
    }
    deleteEntity: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

// Delta-logged columns.
const UPDATABLE = [
  'name',
  'description',
  'status',
  'retiredReason',
  'injectionMode',
  'tags',
  'state',
] as const

function fullRow(entry: NewEntity): Entity {
  // Apply SQLite defaults so the inserted row and the store create-patch row are byte-identical.
  return {
    id: entry.id,
    branchId: entry.branchId,
    kind: entry.kind,
    name: entry.name,
    description: entry.description ?? null,
    status: entry.status,
    retiredReason: entry.retiredReason ?? null,
    injectionMode: entry.injectionMode,
    nameCollisionFlag: entry.nameCollisionFlag ?? 0,
    state: entry.state ?? emptyEntityState(entry.kind),
    tags: entry.tags ?? [],
    embeddingStale: entry.embeddingStale ?? 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createEntity')
    throw new Error(`handler/kind mismatch: expected 'createEntity', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const scalars = entityWriteSchema.safeParse(row)
  if (!scalars.success)
    return { status: 'rejected', reason: `invalid entity: ${scalars.error.message}` }
  const parsed = entityStateSchemaForKind(row.kind).safeParse(row.state)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid ${row.kind} state: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(entities).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntity')
    throw new Error(`handler/kind mismatch: expected 'updateEntity', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }

  const scalars = entityWriteSchema.partial().safeParse(patch)
  if (!scalars.success)
    return { status: 'rejected', reason: `invalid entity patch: ${scalars.error.message}` }

  if (patch.state !== undefined) {
    const parsed = entityStateSchemaForKind(current.kind).safeParse(patch.state)
    if (!parsed.success)
      return {
        status: 'rejected',
        reason: `invalid ${current.kind} state: ${parsed.error.message}`,
      }
  }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = patch[col]
    if (col === 'state') {
      const prior = (current.state ?? emptyEntityState(current.kind)) as Record<string, unknown>
      undoPayload.state = computeUndoPayload(
        entityStateColumnSchema,
        prior,
        patch.state as Record<string, unknown>,
      )
    } else {
      undoPayload[col] = current[col as keyof Entity]
    }
  }
  // A patch that parsed but touched no updatable column would reach Drizzle's
  // .set({}) and throw "No values to set" — reject instead.
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for entities ${bid}:${id} has no updatable fields`,
    }

  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(entities)
        .set(set)
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteEntity')
    throw new Error(`handler/kind mismatch: expected 'deleteEntity', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target entities ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(entities)
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerEntities(): void {
  register({
    table: 'entities',
    descriptor: { table: entities, idCol: entities.id, branchCol: entities.branchId },
    columnSchemas: { state: entityStateColumnSchema },
    handlers: {
      createEntity: createHandler,
      updateEntity: updateHandler,
      deleteEntity: deleteHandler,
    },
    patcher: (branchId, p) => entitiesStore.patch(branchId, p),
  })
}
