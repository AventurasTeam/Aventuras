import { and, eq } from 'drizzle-orm'

import type { EntryMetadata, NewStoryEntry, StoryEntry } from '@/lib/db'
import { entryMetadataSchema, storyEntries } from '@/lib/db'
import { entriesStore } from '@/lib/stores'

import { computeUndoPayload } from '../delta/delta-encoding'
import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

export const STORY_ENTRY_REJECTION = {
  openingPosition: 'opening-position',
  openingDeleteBlocked: 'opening-delete-blocked',
  rollbackFloor: 'rollback-floor',
  inFlight: 'in-flight-gated',
  notFound: 'not-found',
} as const
export type StoryEntryRejectionCode =
  (typeof STORY_ENTRY_REJECTION)[keyof typeof STORY_ENTRY_REJECTION]

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createStoryEntry: { source: DeltaSource; payload: { entry: NewStoryEntry } }
    updateStoryEntryMetadata: {
      source: DeltaSource
      payload: { branchId: string; id: string; metadata: EntryMetadata }
    }
    deleteStoryEntry: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

function fullRow(entry: NewStoryEntry): StoryEntry {
  return {
    id: entry.id,
    branchId: entry.branchId,
    position: entry.position,
    kind: entry.kind,
    content: entry.content,
    chapterId: entry.chapterId ?? null,
    metadata: entry.metadata ?? null,
    createdAt: entry.createdAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createStoryEntry')
    throw new Error(`handler/kind mismatch: expected 'createStoryEntry', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.kind === 'opening' && entry.position !== 1)
    return {
      status: 'rejected',
      reason: `opening must be at position 1, got ${entry.position}`,
      code: STORY_ENTRY_REJECTION.openingPosition,
    }
  // reverse-replay locates the row by the delta's branch; a run-ctx vs payload
  // branch split would reverse the wrong branch.
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta branch ${branchId} vs entry branch ${entry.branchId}`,
    }
  const row = fullRow(entry)
  return {
    status: 'ok',
    targetTable: 'story_entries',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(storyEntries).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateStoryEntryMetadata')
    throw new Error(
      `handler/kind mismatch: expected 'updateStoryEntryMetadata', got '${action.kind}'`,
    )
  const { branchId: bid, id, metadata } = action.payload
  if (bid !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta branch ${branchId} vs target branch ${bid}`,
    }
  const [current] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, bid), eq(storyEntries.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target story_entries ${bid}:${id} not found` }
  const before = (current.metadata ?? {}) as Record<string, unknown>
  return {
    status: 'ok',
    targetTable: 'story_entries',
    targetId: id,
    op: 'update',
    // Column-keyed: reverse-replay iterates undo_payload's top-level keys as
    // target columns. metadata is the column; the inner object is its partial.
    undoPayload: { metadata: computeUndoPayload(entryMetadataSchema, before, metadata) },
    ops: [
      ctx.db
        .update(storyEntries)
        .set({ metadata })
        .where(and(eq(storyEntries.branchId, bid), eq(storyEntries.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: { metadata } },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteStoryEntry')
    throw new Error(`handler/kind mismatch: expected 'deleteStoryEntry', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta branch ${branchId} vs target branch ${bid}`,
    }
  const [current] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, bid), eq(storyEntries.id, id)))
  if (!current)
    return {
      status: 'rejected',
      reason: `delete target story_entries ${bid}:${id} not found`,
      code: STORY_ENTRY_REJECTION.notFound,
    }
  if (current.kind === 'opening')
    return {
      status: 'rejected',
      reason: 'the opening entry cannot be deleted',
      code: STORY_ENTRY_REJECTION.openingDeleteBlocked,
    }
  return {
    status: 'ok',
    targetTable: 'story_entries',
    targetId: id,
    op: 'delete',
    // Full row so reverse-replay rebuilds both the SQLite re-insert and the store create-patch.
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(storyEntries)
        .where(and(eq(storyEntries.branchId, bid), eq(storyEntries.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerStoryEntries(): void {
  register({
    table: 'story_entries',
    descriptor: { table: storyEntries, idCol: storyEntries.id, branchCol: storyEntries.branchId },
    columnSchemas: { metadata: entryMetadataSchema },
    handlers: {
      createStoryEntry: createHandler,
      updateStoryEntryMetadata: updateHandler,
      deleteStoryEntry: deleteHandler,
    },
    patcher: (branchId, p) => entriesStore.patch(branchId, p),
  })
}
