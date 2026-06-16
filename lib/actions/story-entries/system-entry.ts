import { and, eq, sql } from 'drizzle-orm'

import { storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'

import type { DbCtx } from '../types'

// System entries are diagnostic artifacts, not narrative state: written directly
// (no delta, no source), the branch-tail singleton — at most one per branch,
// always the last entry. Removed on resolution or at the next main pipeline run.
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
  args: { branchId: string; content: string },
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
        metadata: null,
        createdAt: Date.now(),
      })
      .toSQL(),
  ])
  return id
}
