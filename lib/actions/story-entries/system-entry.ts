import { and, eq, sql } from 'drizzle-orm'

import { storyEntries, type SystemFailureMeta } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { entriesStore } from '@/lib/stores'

import type { DbCtx } from '../types'

function deleteSystemEntries(branchId: string, ctx: DbCtx) {
  return ctx.db
    .delete(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.kind, 'system')))
    .toSQL()
}

// The store copy goes with the row: a card left standing offers a Retry for an entry that's gone.
export async function clearSystemEntry(branchId: string, ctx: DbCtx): Promise<void> {
  await ctx.runInTransaction([deleteSystemEntries(branchId, ctx)])
  for (const row of entriesStore.getEntries(branchId).values())
    if (row.kind === 'system') entriesStore.patch(branchId, { op: 'delete', id: row.id })
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

// writeSystemEntry keeps one system row per branch, so the first found is the standing one.
async function standingSubmission(
  branchId: string,
  ctx: DbCtx,
): Promise<SystemFailureMeta['submission']> {
  const [standing] = await ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.kind, 'system')))
    .limit(1)
  return standing?.metadata?.systemFailure?.submission
}

/**
 * `writeSystemEntry` for a writer with no route to reload: the standing entry's held text carries
 * across as the new entry's `submission` (reader-composer.md → Custody of the turn's text), and the
 * reader's store takes the new row in place of the old when it holds the branch.
 */
export async function raiseSystemEntry(
  args: { branchId: string; content: string; failure: Omit<SystemFailureMeta, 'submission'> },
  ctx: DbCtx,
): Promise<string> {
  // Overrides any submission the caller's value carried: only the standing text is the user's.
  const failure = { ...args.failure, submission: await standingSubmission(args.branchId, ctx) }
  const id = await writeSystemEntry(
    { branchId: args.branchId, content: args.content, failure },
    ctx,
  )
  if (entriesStore.getLoadedBranch() !== args.branchId) return id
  const [row] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, args.branchId), eq(storyEntries.id, id)))
  if (row === undefined) return id
  // A reload during the read may already hold the new row; patch() skips a branch no longer held.
  for (const held of entriesStore.getEntries(args.branchId).values())
    if (held.kind === 'system' && held.id !== id)
      entriesStore.patch(args.branchId, { op: 'delete', id: held.id })
  entriesStore.patch(args.branchId, { op: 'create', id, row })
  return id
}
