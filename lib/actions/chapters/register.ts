import { and, eq } from 'drizzle-orm'

import type { Chapter, NewChapter } from '@/lib/db'
import { chapterWriteSchema, chapters } from '@/lib/db'
import { chaptersStore } from '@/lib/stores'

import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type ChapterUpdatePatch = Partial<{
  sequenceNumber: number
  title: string
  summary: string
  theme: string
  keywords: string[]
  startEntryId: string
  endEntryId: string
  tokenCount: number
}>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createChapter: { source: DeltaSource; payload: { entry: NewChapter } }
    updateChapter: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: ChapterUpdatePatch }
    }
    deleteChapter: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

// Delta-logged columns. Operational (embedding_stale), timestamps (closed_at,
// created_at, updated_at), and the PK (id, branch_id) are never in this set.
const UPDATABLE = [
  'sequenceNumber',
  'title',
  'summary',
  'theme',
  'keywords',
  'startEntryId',
  'endEntryId',
  'tokenCount',
] as const

function fullRow(entry: NewChapter): Chapter {
  // Apply SQLite defaults so the inserted row and the store create-patch row are byte-identical.
  return {
    id: entry.id,
    branchId: entry.branchId,
    sequenceNumber: entry.sequenceNumber,
    title: entry.title,
    summary: entry.summary,
    theme: entry.theme,
    keywords: entry.keywords ?? [],
    startEntryId: entry.startEntryId,
    endEntryId: entry.endEntryId,
    tokenCount: entry.tokenCount,
    closedAt: entry.closedAt,
    embeddingStale: entry.embeddingStale ?? 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createChapter')
    throw new Error(`handler/kind mismatch: expected 'createChapter', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = chapterWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid chapter: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'chapters',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(chapters).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateChapter')
    throw new Error(`handler/kind mismatch: expected 'updateChapter', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = chapterWriteSchema.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid chapter patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.branchId, bid), eq(chapters.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target chapters ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = patch[col]
    // No columnSchemas registered: flat arrays + scalars take the whole prior value as undo.
    undoPayload[col] = current[col as keyof Chapter]
  }
  // A patch that parsed but touched no updatable column (e.g. closed_at only) would
  // otherwise reach Drizzle's .set({}) and throw "No values to set" — reject instead.
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for chapters ${bid}:${id} has no updatable fields`,
    }

  return {
    status: 'ok',
    targetTable: 'chapters',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(chapters)
        .set(set)
        .where(and(eq(chapters.branchId, bid), eq(chapters.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteChapter')
    throw new Error(`handler/kind mismatch: expected 'deleteChapter', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.branchId, bid), eq(chapters.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target chapters ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'chapters',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(chapters)
        .where(and(eq(chapters.branchId, bid), eq(chapters.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerChapters(): void {
  register({
    table: 'chapters',
    descriptor: { table: chapters, idCol: chapters.id, branchCol: chapters.branchId },
    columnSchemas: {},
    handlers: {
      createChapter: createHandler,
      updateChapter: updateHandler,
      deleteChapter: deleteHandler,
    },
    patcher: (branchId, p) => chaptersStore.patch(branchId, p),
  })
}
