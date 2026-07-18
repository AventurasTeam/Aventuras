import { and, eq, sql } from 'drizzle-orm'

import { storyEntries, type SystemFailureMeta } from '@/lib/db'
import { generateId } from '@/lib/ids'

import type { DbCtx } from '../types'

function deleteSystemEntries(branchId: string, ctx: DbCtx) {
  return ctx.db
    .delete(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.kind, 'system')))
    .toSQL()
}

export async function clearSystemEntry(branchId: string, ctx: DbCtx): Promise<void> {
  await ctx.runInTransaction([deleteSystemEntries(branchId, ctx)])
}

export async function writeSystemEntry(
  args: { branchId: string; content: string; failure?: SystemFailureMeta },
  ctx: DbCtx,
): Promise<string> {
  const id = generateId('entry')
  await ctx.runInTransaction([
    // Clear any existing system entry first so MAX(position) below resolves to
    // the real content tail — keeps the singleton at the true last position.
    deleteSystemEntries(args.branchId, ctx),
    ctx.db
      .insert(storyEntries)
      .values({
        id,
        branchId: args.branchId,
        position: sql<number>`(SELECT COALESCE(MAX(${storyEntries.position}), 0) + 1 FROM ${storyEntries} WHERE ${storyEntries.branchId} = ${args.branchId})`,
        kind: 'system',
        content: args.content,
        // worldTime 0 is inert: system entries are excluded from worldTime
        // inheritance (submit-turn.ts) and cleared before the next submit.
        metadata: args.failure
          ? {
              sceneEntities: [],
              currentLocationId: null,
              worldTime: 0,
              systemFailure: args.failure,
            }
          : null,
        createdAt: Date.now(),
      })
      .toSQL(),
  ])
  return id
}
