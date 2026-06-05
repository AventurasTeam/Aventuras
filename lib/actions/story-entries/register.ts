import { and, eq } from 'drizzle-orm'

import type { EntryMetadata, NewStoryEntry } from '@/lib/db'
import { entryMetadataSchema, storyEntries } from '@/lib/db'

import { computeUndoPayload } from '../delta/delta-encoding'
import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createStoryEntry: { source: DeltaSource; payload: { entry: NewStoryEntry } }
    updateStoryEntryMetadata: {
      source: DeltaSource
      payload: { branchId: string; id: string; metadata: EntryMetadata }
    }
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createStoryEntry')
    throw new Error(`handler/kind mismatch: expected 'createStoryEntry', got '${action.kind}'`)
  const { entry } = action.payload
  // reverse-replay locates the row by the delta's branch; a run-ctx vs payload
  // branch split would reverse the wrong branch.
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta branch ${branchId} vs entry branch ${entry.branchId}`,
    }
  return {
    status: 'ok',
    targetTable: 'story_entries',
    targetId: entry.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(storyEntries).values(entry).toSQL()],
    patch: null, // no working-set store to mirror into yet
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
    patch: null,
  }
}

export function registerStoryEntries(): void {
  // No patcher: story_entries has no working-set store to mirror into yet (persist-only).
  register({
    table: 'story_entries',
    descriptor: { table: storyEntries, idCol: storyEntries.id, branchCol: storyEntries.branchId },
    columnSchemas: { metadata: entryMetadataSchema },
    handlers: { createStoryEntry: createHandler, updateStoryEntryMetadata: updateHandler },
  })
}
