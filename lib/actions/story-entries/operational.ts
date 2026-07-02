import { and, desc, eq, sql, type SQL } from 'drizzle-orm'

import type { Delta } from '@/lib/db'
import { deltas, storyEntries } from '@/lib/db'
import { entriesStore, generationStore } from '@/lib/stores'

import { reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import type { DbCtx } from '../types'
import { STORY_ENTRY_REJECTION, type StoryEntryRejectionCode } from './register'

export type StoryEntryRejection = {
  status: 'rejected'
  reason: string
  code: StoryEntryRejectionCode
}

// story_entries.content is the one narrative field exempt from the delta log
// (data-model.md -> Entry mutability & rollback). Direct row update, no delta.
export async function updateStoryEntryContent(
  branchId: string,
  id: string,
  content: string,
  ctx: DbCtx,
): Promise<{ status: 'ok' } | StoryEntryRejection> {
  if (generationStore.isUserEditBlocked())
    return {
      status: 'rejected',
      reason: 'generation in flight',
      code: STORY_ENTRY_REJECTION.inFlight,
    }
  const [current] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
  if (!current)
    return {
      status: 'rejected',
      reason: `story_entries ${branchId}:${id} not found`,
      code: STORY_ENTRY_REJECTION.notFound,
    }
  await ctx.runInTransaction([
    ctx.db
      .update(storyEntries)
      .set({ content })
      .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
      .toSQL(),
  ])
  entriesStore.patch(branchId, { op: 'update', id, columns: { content } })
  return { status: 'ok' }
}

export type RollbackCounts = { entries: number; chapters: number; worldStateChanges: number }

// Resolves the rollback-window predicate shared by the preview (counts) and
// execute paths, so each builds its own select — the count path skips the
// undo_payload blob it never reads.
async function resolveRollbackWindow(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<{ where: SQL | undefined } | StoryEntryRejection> {
  const [target] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, targetId)))
  if (!target)
    return {
      status: 'rejected',
      reason: `target ${branchId}:${targetId} not found`,
      code: STORY_ENTRY_REJECTION.notFound,
    }
  if (target.kind === 'opening')
    return {
      status: 'rejected',
      reason: 'the opening is the rollback floor',
      code: STORY_ENTRY_REJECTION.rollbackFloor,
    }

  // N = B's own create-delta log_position. Found by target_id (not entry_id), so
  // this works whether or not foreground deltas stamp entry_id.
  const [createDelta] = await ctx.db
    .select({ lp: deltas.logPosition })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, 'story_entries'),
        eq(deltas.targetId, targetId),
        eq(deltas.op, 'create'),
      ),
    )
  if (!createDelta)
    return {
      status: 'rejected',
      reason: `no create delta for ${targetId}`,
      code: STORY_ENTRY_REJECTION.rollbackFloor,
    }

  // Survival-anchor predicate (data-model.md -> Survival anchor). In M2 every
  // foreground delta carries entry_id = NULL so this reduces to the bare suffix;
  // the position-correlated branch is correct-by-construction and first exercised in M3.3.
  return {
    where: and(
      eq(deltas.branchId, branchId),
      sql`${deltas.logPosition} >= ${createDelta.lp}`,
      sql`(${deltas.entryId} IS NULL OR (SELECT ${storyEntries.position} FROM ${storyEntries} WHERE ${storyEntries.branchId} = ${deltas.branchId} AND ${storyEntries.id} = ${deltas.entryId}) >= ${target.position})`,
    ),
  }
}

function countBuckets(rows: Pick<Delta, 'op' | 'targetTable'>[]): RollbackCounts {
  let entries = 0
  let chapters = 0
  for (const r of rows) {
    if (r.op === 'create' && r.targetTable === 'story_entries') entries++
    else if (r.op === 'create' && r.targetTable === 'chapters') chapters++
  }
  return { entries, chapters, worldStateChanges: rows.length - entries - chapters }
}

export async function getRollbackCounts(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<RollbackCounts | StoryEntryRejection> {
  const win = await resolveRollbackWindow(branchId, targetId, ctx)
  if ('status' in win) return win
  // Counts are order-independent and never read undo_payload — project neither.
  const rows = await ctx.db
    .select({ op: deltas.op, targetTable: deltas.targetTable })
    .from(deltas)
    .where(win.where)
  return countBuckets(rows)
}

export async function rollbackToEntry(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<{ status: 'ok'; counts: RollbackCounts } | StoryEntryRejection> {
  if (generationStore.isUserEditBlocked())
    return {
      status: 'rejected',
      reason: 'generation in flight',
      code: STORY_ENTRY_REJECTION.inFlight,
    }

  generationStore.setReversalInProgress(true)
  try {
    const win = await resolveRollbackWindow(branchId, targetId, ctx)
    if ('status' in win) return win
    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(win.where)
      .orderBy(desc(deltas.logPosition))) as Delta[]
    const counts = countBuckets(rows)
    await reverseAndPruneDeltaRows(rows, ctx)
    return { status: 'ok', counts }
  } finally {
    generationStore.setReversalInProgress(false)
  }
}
