import { and, eq } from 'drizzle-orm'

import type { Happening, NewHappening } from '@/lib/db'
import { happenings, happeningWriteObject, happeningWriteSchema } from '@/lib/db'
import { happeningsStore } from '@/lib/stores'

import { nullifyRef } from '../coerce'
import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type HappeningUpdatePatch = Partial<{
  title: string
  description: string | null
  category: string | null
  icon: string | null
  temporal: string | null
  occurredAtEntryId: string | null
  commonKnowledge: 0 | 1
}>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createHappening: { source: DeltaSource; payload: { entry: NewHappening } }
    updateHappening: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: HappeningUpdatePatch }
    }
    deleteHappening: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

// Delta-logged columns.
const UPDATABLE = [
  'title',
  'description',
  'category',
  'icon',
  'temporal',
  'occurredAtEntryId',
  'commonKnowledge',
] as const

function fullRow(entry: NewHappening): Happening {
  // Apply SQLite defaults so the inserted row and the store create-patch row are byte-identical.
  return {
    id: entry.id,
    branchId: entry.branchId,
    title: entry.title,
    description: entry.description ?? null,
    category: entry.category ?? null,
    icon: entry.icon ?? null,
    temporal: nullifyRef(entry.temporal),
    occurredAtEntryId: nullifyRef(entry.occurredAtEntryId),
    commonKnowledge: entry.commonKnowledge ?? 0,
    embeddingStale: entry.embeddingStale ?? 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createHappening')
    throw new Error(`handler/kind mismatch: expected 'createHappening', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = happeningWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid happening: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'happenings',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(happenings).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateHappening')
    throw new Error(`handler/kind mismatch: expected 'updateHappening', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = happeningWriteObject.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid happening patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target happening ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    const next =
      col === 'temporal' || col === 'occurredAtEntryId' ? nullifyRef(patch[col]) : patch[col]
    set[col] = next
    undoPayload[col] = current[col as keyof Happening]
  }
  // A patch that parsed but touched no updatable column would reach Drizzle's
  // .set({}) and throw "No values to set" — reject instead.
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for happening ${bid}:${id} has no updatable fields`,
    }
  const merged = { ...current, ...set } as Happening
  // Friendly graceful-reject surface over the DDL CHECK constraint.
  if (merged.occurredAtEntryId != null && merged.temporal != null)
    return {
      status: 'rejected',
      reason: 'occurred_at_entry_id and temporal are mutually exclusive',
    }

  return {
    status: 'ok',
    targetTable: 'happenings',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(happenings)
        .set(set)
        .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteHappening')
    throw new Error(`handler/kind mismatch: expected 'deleteHappening', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target happening ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'happenings',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(happenings)
        .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerHappenings(): void {
  register({
    table: 'happenings',
    descriptor: { table: happenings, idCol: happenings.id, branchCol: happenings.branchId },
    columnSchemas: {},
    handlers: {
      createHappening: createHandler,
      updateHappening: updateHandler,
      deleteHappening: deleteHandler,
    },
    patcher: (branchId, p) => happeningsStore.patch(branchId, p),
  })
}
