import { and, eq } from 'drizzle-orm'

import type { HappeningInvolvement, NewHappeningInvolvement } from '@/lib/db'
import { happeningInvolvements, happeningInvolvementWriteSchema } from '@/lib/db'
import { happeningInvolvementsStore } from '@/lib/stores'

import { missingRef, MISSING_REF } from '../delta/live-refs'
import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createHappeningInvolvement: { source: DeltaSource; payload: { entry: NewHappeningInvolvement } }
    updateHappeningInvolvement: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: { role?: string | null } }
    }
    deleteHappeningInvolvement: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

function fullRow(entry: NewHappeningInvolvement): HappeningInvolvement {
  return {
    id: entry.id,
    branchId: entry.branchId,
    happeningId: entry.happeningId,
    entityId: entry.entityId,
    role: entry.role ?? null,
  }
}

const createHandler: ActionHandler = async (action, branchId, ctx, group) => {
  if (action.kind !== 'createHappeningInvolvement')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = happeningInvolvementWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid involvement: ${parsed.error.message}` }
  const refs = [
    { table: 'happenings', id: row.happeningId },
    { table: 'entities', id: row.entityId },
  ] as const
  if (await missingRef(ctx, branchId, refs, group)) return MISSING_REF
  return {
    status: 'ok',
    targetTable: 'happening_involvements',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(happeningInvolvements).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateHappeningInvolvement')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  if (!('role' in patch)) return { status: 'rejected', reason: 'no involvement fields to update' }
  const parsed = happeningInvolvementWriteSchema
    .pick({ role: true })
    .safeParse({ role: patch.role })
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid involvement patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(happeningInvolvements)
    .where(and(eq(happeningInvolvements.branchId, bid), eq(happeningInvolvements.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target involvement ${bid}:${id} not found` }
  const set = { role: patch.role ?? null }
  return {
    status: 'ok',
    targetTable: 'happening_involvements',
    targetId: id,
    op: 'update',
    undoPayload: { role: current.role },
    ops: [
      ctx.db
        .update(happeningInvolvements)
        .set(set)
        .where(and(eq(happeningInvolvements.branchId, bid), eq(happeningInvolvements.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteHappeningInvolvement')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(happeningInvolvements)
    .where(and(eq(happeningInvolvements.branchId, bid), eq(happeningInvolvements.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target involvement ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'happening_involvements',
    targetId: id,
    op: 'delete',
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(happeningInvolvements)
        .where(and(eq(happeningInvolvements.branchId, bid), eq(happeningInvolvements.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerHappeningInvolvements(): void {
  register({
    table: 'happening_involvements',
    descriptor: {
      table: happeningInvolvements,
      idCol: happeningInvolvements.id,
      branchCol: happeningInvolvements.branchId,
    },
    columnSchemas: {},
    handlers: {
      createHappeningInvolvement: createHandler,
      updateHappeningInvolvement: updateHandler,
      deleteHappeningInvolvement: deleteHandler,
    },
    patcher: (branchId, p) => happeningInvolvementsStore.patch(branchId, p),
  })
}
