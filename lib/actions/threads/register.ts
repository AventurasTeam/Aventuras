import { and, eq } from 'drizzle-orm'

import type { NewThread, Thread } from '@/lib/db'
import { KIND_FIELDS, threadWriteSchema, threads } from '@/lib/db'
import { threadsStore } from '@/lib/stores'

import { nullifyRef } from '../coerce'
import { cascadedDelete, rowCascade } from '../delta/delete-cascade'
import { register, TARGET_NOT_FOUND, undefinedColumn, type ActionHandler } from '../delta/registry'
import {
  USER_EDITED_SINCE_PROSE,
  userEditsSinceProse,
  wroteThreadStatus,
} from '../delta/user-precedence'
import { isUserOriginatedSource, type DeltaSource, type ProseEntryId } from '../types'

const cascade = rowCascade('thread')

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
    setThreadStatus: {
      source: DeltaSource
      /** classifier.md → Threads: a pass moves a thread to these; `pending` is a create's only. */
      payload: { branchId: string; id: string; proseEntryId: ProseEntryId } & (
        | { status: 'active' }
        | {
            status: 'resolved' | 'failed'
            /** The change's source turn, written to a pass's thread. */
            resolvedAtEntryId: string
          }
      )
    }
  }
}

// Delta-logged narrative columns.
export const UPDATABLE = [
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
    embeddingStale: entry.embeddingStale ?? 1,
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
    return {
      status: 'rejected',
      reason: `update target threads ${bid}:${id} not found`,
      code: TARGET_NOT_FOUND,
    }
  const blank = undefinedColumn(patch, UPDATABLE)
  if (blank != null)
    return { status: 'rejected', reason: `invalid thread patch: ${blank} is undefined` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = REF_COLS.has(col) ? nullifyRef(patch[col] as string | null | undefined) : patch[col]
    // No columnSchemas registered: scalar/nullable columns take the whole prior value as undo.
    undoPayload[col] = current[col as keyof Thread]
  }
  // The ref is the pass's claim of where its status ended: a user's status change retracts it, and
  // a thread with refs logs it beside every status change, so a reversal restores the pair whole.
  const carriesRefs = current.triggeredAtEntryId !== null || current.resolvedAtEntryId !== null
  if (
    carriesRefs &&
    !('resolvedAtEntryId' in patch) &&
    'status' in set &&
    set.status !== current.status
  ) {
    set.resolvedAtEntryId = isUserOriginatedSource(action.source) ? null : current.resolvedAtEntryId
    undoPayload.resolvedAtEntryId = current.resolvedAtEntryId
  }
  // A patch that parsed but touched no updatable column would reach Drizzle's
  // .set({}) and throw "No values to set" — reject instead.
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for threads ${bid}:${id} has no updatable fields`,
    }

  // Embedded-column change flips the flag; see entities/register.ts for the reasoning.
  const [firstField, secondField] = KIND_FIELDS.thread
  if (
    (firstField in set && set[firstField] !== (current[firstField] ?? null)) ||
    (secondField in set && set[secondField] !== (current[secondField] ?? null))
  ) {
    set.embeddingStale = 1
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

const setStatusHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'setThreadStatus')
    throw new Error(`handler/kind mismatch: expected 'setThreadStatus', got '${action.kind}'`)
  const { payload } = action
  const { branchId: bid, id, status, proseEntryId } = payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.branchId, bid), eq(threads.id, id)))
  if (!current)
    return {
      status: 'rejected',
      reason: `status target threads ${bid}:${id} not found`,
      code: 'noop',
    }
  if (current.status === status)
    return { status: 'rejected', reason: 'status-unchanged', code: 'noop' }
  if (
    proseEntryId !== null &&
    wroteThreadStatus(await userEditsSinceProse(ctx, bid, 'threads', id, proseEntryId))
  )
    return { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }
  const set: Partial<Pick<Thread, 'status' | 'resolvedAtEntryId'>> = { status }
  const undoPayload: Record<string, unknown> = { status: current.status }
  // Entry refs are AI-only (data-model.md → Authorship contract): a user's thread keeps both null.
  // A pass's thread logs the ref beside the status, even unchanged, so a reversal restores both.
  if (current.triggeredAtEntryId !== null) {
    set.resolvedAtEntryId =
      payload.status === 'active' ? null : nullifyRef(payload.resolvedAtEntryId)
    undoPayload.resolvedAtEntryId = current.resolvedAtEntryId
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
    return {
      status: 'rejected',
      reason: `delete target threads ${bid}:${id} not found`,
      code: TARGET_NOT_FOUND,
    }
  return cascadedDelete(ctx, cascade, {
    table: 'threads',
    row: current,
    deleteOp: ctx.db
      .delete(threads)
      .where(and(eq(threads.branchId, bid), eq(threads.id, id)))
      .toSQL(),
  })
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
      setThreadStatus: setStatusHandler,
    },
    patcher: (branchId, p) => threadsStore.patch(branchId, p),
    cascade,
  })
}
