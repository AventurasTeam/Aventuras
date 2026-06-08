import { and, eq } from 'drizzle-orm'

import type { BranchEraFlip, NewBranchEraFlip } from '@/lib/db'
import { branchEraFlipWriteSchema, branchEraFlips } from '@/lib/db'
import { eraFlipsStore } from '@/lib/stores'

import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type BranchEraFlipUpdatePatch = Partial<{ atWorldtime: number; eraName: string }>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createBranchEraFlip: { source: DeltaSource; payload: { entry: NewBranchEraFlip } }
    updateBranchEraFlip: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: BranchEraFlipUpdatePatch }
    }
    deleteBranchEraFlip: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

const UPDATABLE = ['atWorldtime', 'eraName'] as const

function fullRow(entry: NewBranchEraFlip): BranchEraFlip {
  return {
    id: entry.id,
    branchId: entry.branchId,
    atWorldtime: entry.atWorldtime,
    eraName: entry.eraName,
    createdAt: entry.createdAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createBranchEraFlip')
    throw new Error(`handler/kind mismatch: expected 'createBranchEraFlip', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = branchEraFlipWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid era flip: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'branch_era_flips',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(branchEraFlips).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateBranchEraFlip')
    throw new Error(`handler/kind mismatch: expected 'updateBranchEraFlip', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = branchEraFlipWriteSchema.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid era flip patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(branchEraFlips)
    .where(and(eq(branchEraFlips.branchId, bid), eq(branchEraFlips.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target branch_era_flips ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = patch[col]
    // No columnSchemas registered: scalars take the whole prior value as undo.
    undoPayload[col] = current[col as keyof BranchEraFlip]
  }
  // An empty patch parses but would reach Drizzle's .set({}) and throw "No values to set" — reject instead.
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for branch_era_flips ${bid}:${id} has no updatable fields`,
    }

  return {
    status: 'ok',
    targetTable: 'branch_era_flips',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(branchEraFlips)
        .set(set)
        .where(and(eq(branchEraFlips.branchId, bid), eq(branchEraFlips.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteBranchEraFlip')
    throw new Error(`handler/kind mismatch: expected 'deleteBranchEraFlip', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(branchEraFlips)
    .where(and(eq(branchEraFlips.branchId, bid), eq(branchEraFlips.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target branch_era_flips ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'branch_era_flips',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(branchEraFlips)
        .where(and(eq(branchEraFlips.branchId, bid), eq(branchEraFlips.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerBranchEraFlips(): void {
  register({
    table: 'branch_era_flips',
    descriptor: {
      table: branchEraFlips,
      idCol: branchEraFlips.id,
      branchCol: branchEraFlips.branchId,
    },
    columnSchemas: {},
    handlers: {
      createBranchEraFlip: createHandler,
      updateBranchEraFlip: updateHandler,
      deleteBranchEraFlip: deleteHandler,
    },
    patcher: (branchId, p) => eraFlipsStore.patch(branchId, p),
  })
}
