import { and, eq } from 'drizzle-orm'

import type { Lore, NewLore } from '@/lib/db'
import { lore, loreWriteSchema } from '@/lib/db'
import { loreStore } from '@/lib/stores'

import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type LoreUpdatePatch = Partial<{
  title: string
  body: string | null
  category: string | null
  tags: string[]
  keywords: string[]
  injectionMode: Lore['injectionMode']
  priority: number
}>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createLore: { source: DeltaSource; payload: { entry: NewLore } }
    updateLore: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: LoreUpdatePatch }
    }
    deleteLore: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

// Delta-logged columns.
const UPDATABLE = [
  'title',
  'body',
  'category',
  'tags',
  'keywords',
  'injectionMode',
  'priority',
] as const

function fullRow(entry: NewLore): Lore {
  // Apply SQLite defaults so the inserted row and the store create-patch row are byte-identical.
  return {
    id: entry.id,
    branchId: entry.branchId,
    title: entry.title,
    body: entry.body ?? null,
    category: entry.category ?? null,
    tags: entry.tags ?? [],
    keywords: entry.keywords ?? [],
    injectionMode: entry.injectionMode,
    priority: entry.priority ?? 0,
    embeddingStale: entry.embeddingStale ?? 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createLore')
    throw new Error(`handler/kind mismatch: expected 'createLore', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = loreWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid lore: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'lore',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(lore).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateLore')
    throw new Error(`handler/kind mismatch: expected 'updateLore', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = loreWriteSchema.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid lore patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(lore)
    .where(and(eq(lore.branchId, bid), eq(lore.id, id)))
  if (!current) return { status: 'rejected', reason: `update target lore ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = patch[col]
    // No columnSchemas registered: flat arrays + scalars take the whole prior value as undo.
    undoPayload[col] = current[col as keyof Lore]
  }
  // A patch that parsed but touched no updatable column would reach Drizzle's
  // .set({}) and throw "No values to set" — reject instead.
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for lore ${bid}:${id} has no updatable fields`,
    }

  return {
    status: 'ok',
    targetTable: 'lore',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(lore)
        .set(set)
        .where(and(eq(lore.branchId, bid), eq(lore.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteLore')
    throw new Error(`handler/kind mismatch: expected 'deleteLore', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(lore)
    .where(and(eq(lore.branchId, bid), eq(lore.id, id)))
  if (!current) return { status: 'rejected', reason: `delete target lore ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'lore',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(lore)
        .where(and(eq(lore.branchId, bid), eq(lore.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerLore(): void {
  register({
    table: 'lore',
    descriptor: { table: lore, idCol: lore.id, branchCol: lore.branchId },
    columnSchemas: {},
    handlers: { createLore: createHandler, updateLore: updateHandler, deleteLore: deleteHandler },
    patcher: (branchId, p) => loreStore.patch(branchId, p),
  })
}
