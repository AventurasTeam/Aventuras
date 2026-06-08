import { and, eq } from 'drizzle-orm'

import type { EntryAsset, NewEntryAsset } from '@/lib/db'
import { entryAssetWriteSchema, entryAssets } from '@/lib/db'
import { entryAssetsStore } from '@/lib/stores'

import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type EntryAssetUpdatePatch = Partial<{ role: string | null; position: number | null }>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createEntryAsset: { source: DeltaSource; payload: { entry: NewEntryAsset } }
    updateEntryAsset: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: EntryAssetUpdatePatch }
    }
    deleteEntryAsset: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

const UPDATABLE = ['role', 'position'] as const

function fullRow(entry: NewEntryAsset): EntryAsset {
  return {
    id: entry.id,
    branchId: entry.branchId,
    entryId: entry.entryId,
    assetId: entry.assetId,
    role: entry.role ?? null,
    position: entry.position ?? null,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createEntryAsset')
    throw new Error(`handler/kind mismatch: expected 'createEntryAsset', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = entryAssetWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid entry_asset: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'entry_assets',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(entryAssets).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntryAsset')
    throw new Error(`handler/kind mismatch: expected 'updateEntryAsset', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = entryAssetWriteSchema.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid entry_asset patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(entryAssets)
    .where(and(eq(entryAssets.branchId, bid), eq(entryAssets.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target entry_assets ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = patch[col]
    undoPayload[col] = current[col as keyof EntryAsset]
  }
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for entry_assets ${bid}:${id} has no updatable fields`,
    }

  return {
    status: 'ok',
    targetTable: 'entry_assets',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(entryAssets)
        .set(set)
        .where(and(eq(entryAssets.branchId, bid), eq(entryAssets.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteEntryAsset')
    throw new Error(`handler/kind mismatch: expected 'deleteEntryAsset', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(entryAssets)
    .where(and(eq(entryAssets.branchId, bid), eq(entryAssets.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target entry_assets ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'entry_assets',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(entryAssets)
        .where(and(eq(entryAssets.branchId, bid), eq(entryAssets.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerEntryAssets(): void {
  register({
    table: 'entry_assets',
    descriptor: { table: entryAssets, idCol: entryAssets.id, branchCol: entryAssets.branchId },
    columnSchemas: {},
    handlers: {
      createEntryAsset: createHandler,
      updateEntryAsset: updateHandler,
      deleteEntryAsset: deleteHandler,
    },
    patcher: (branchId, p) => entryAssetsStore.patch(branchId, p),
  })
}
