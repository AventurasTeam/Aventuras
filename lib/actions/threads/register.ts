import { and, eq } from 'drizzle-orm'

import type { NewThread, Thread } from '@/lib/db'
import { threadWriteSchema, threads } from '@/lib/db'
import { threadsStore } from '@/lib/stores'

import { nullifyRef } from '../coerce'
import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type ThreadUpdatePatch = Partial<{
  title: string
  description: string | null
  category: string | null
  icon: string | null
  status: Thread['status']
  injectionMode: Thread['injectionMode']
  triggeredAtEntryId: string | null
  resolvedAtEntryId: string | null
}>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createThread: { source: DeltaSource; payload: { entry: NewThread } }
    updateThread: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: ThreadUpdatePatch }
    }
    deleteThread: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

// Delta-logged narrative columns.
const UPDATABLE = [
  'title',
  'description',
  'category',
  'icon',
  'status',
  'injectionMode',
  'triggeredAtEntryId',
  'resolvedAtEntryId',
] as const

const REF_COLS = new Set(['triggeredAtEntryId', 'resolvedAtEntryId'])

function fullRow(entry: NewThread): Thread {
  // Apply SQLite defaults so the inserted row and the store create-patch row are byte-identical.
  return {
    id: entry.id,
    branchId: entry.branchId,
    title: entry.title,
    description: entry.description ?? null,
    category: entry.category ?? null,
    icon: entry.icon ?? null,
    status: entry.status,
    injectionMode: entry.injectionMode,
    triggeredAtEntryId: nullifyRef(entry.triggeredAtEntryId),
    resolvedAtEntryId: nullifyRef(entry.resolvedAtEntryId),
    embeddingStale: entry.embeddingStale ?? 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createThread')
    throw new Error(`handler/kind mismatch: expected 'createThread', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = threadWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid thread: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'threads',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(threads).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateThread')
    throw new Error(`handler/kind mismatch: expected 'updateThread', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = threadWriteSchema.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid thread patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.branchId, bid), eq(threads.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target threads ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = REF_COLS.has(col) ? nullifyRef(patch[col] as string | null | undefined) : patch[col]
    // No columnSchemas registered: scalar/nullable columns take the whole prior value as undo.
    undoPayload[col] = current[col as keyof Thread]
  }

  return {
    status: 'ok',
    targetTable: 'threads',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(threads)
        .set(set)
        .where(and(eq(threads.branchId, bid), eq(threads.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteThread')
    throw new Error(`handler/kind mismatch: expected 'deleteThread', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.branchId, bid), eq(threads.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target threads ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'threads',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(threads)
        .where(and(eq(threads.branchId, bid), eq(threads.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerThreads(): void {
  register({
    table: 'threads',
    descriptor: { table: threads, idCol: threads.id, branchCol: threads.branchId },
    columnSchemas: {},
    handlers: {
      createThread: createHandler,
      updateThread: updateHandler,
      deleteThread: deleteHandler,
    },
    patcher: (branchId, p) => threadsStore.patch(branchId, p),
  })
}
