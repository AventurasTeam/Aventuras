import { and, desc, eq, sql, type SQL } from 'drizzle-orm'

import type { Delta, SqlOp } from '@/lib/db'
import { deltas, storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { deltaRowOp } from '../delta/delta-row'
import { reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import type { DbCtx } from '../types'
import { resolveContentEditInvalidation } from './classifier-facts'
import { bracketProseReversal, classifierWatermarkClampOps } from './prose-reversal'
import { STORY_ENTRY_REJECTION, type StoryEntryRejectionCode } from './register'

export type StoryEntryRejection = {
  status: 'rejected'
  reason: string
  code: StoryEntryRejectionCode
}

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
  // No re-check inside the bracket, matching rollbackToEntry: the gate above and
  // bracketProseReversal's own flag set are one synchronous block, and the flag
  // itself reads as blocked, so a re-check would reject every call.
  //
  // Held even for an edit that reverses nothing: resolving the scope needs a read,
  // and taking it outside the barrier would race the tail it is classifying.
  return bracketProseReversal(branchId, () =>
    updateStoryEntryContentBracketed(branchId, id, content, ctx),
  )
}

/**
 * The classifier derives its facts from prose alone, so a rewrite leaves the ones
 * it took from the old text standing on nothing. Clamping the watermark on its own
 * only adds the new reading beside the stale one -- chapter-close dedup merges on
 * cast overlap, which a contradicting fact does not have -- so the two run together:
 * reverse what the edit invalidated, then let the next pass re-read it
 * (data-model.md -> Entry mutability & rollback).
 *
 * Both halves ride one scope and neither runs without it: the clamp reopens exactly
 * the window the reversal covers, so a narrower set would re-derive beside surviving
 * facts. Off the head turn the edit is a bare text write.
 *
 * Scoped by source, not by table: `per_turn_classifier` and `piggyback_tagged_block`
 * write the scene metadata a user may have just corrected by hand, and nothing here
 * may undo that. `resolveClassifierFactDeltas` owns closing that set over the
 * happening -> link-row relation.
 */
async function updateStoryEntryContentBracketed(
  branchId: string,
  id: string,
  content: string,
  ctx: DbCtx,
): Promise<{ status: 'ok' } | StoryEntryRejection> {
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

  // The editor gates its commit buttons on the same compare, so this is the backstop for
  // any other caller: on the head turn a no-op write would reverse the entry's facts and
  // spend a classifier pass rebuilding them identically, and it clears the redo stack for
  // nothing on every row.
  if (current.content === content) return { status: 'ok' }

  const invalidation = await resolveContentEditInvalidation(branchId, id, ctx)

  // In scope the clamp is unconditional: a pass that read the entry and extracted
  // nothing still advanced the watermark past it, and the op no-ops when the watermark
  // is already behind. One transaction, because a clamp without the reversal re-derives
  // beside the stale facts and a reversal without the clamp deletes them with nothing
  // to replace them.
  await reverseAndPruneDeltaRows(invalidation.rows, ctx, [
    ctx.db
      .update(storyEntries)
      .set({ content })
      .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
      .toSQL(),
    // Spliced rather than dispatched: applyDeltaAction commits its own transaction, so
    // it could not be atomic with the reversal, and its barrier rejects a user_edit
    // action while `reversalInProgress` is set -- which the bracket above sets.
    deltaRowOp(ctx, {
      deltaId: generateId('delta'),
      branchId,
      // Survival anchor: without it a rollback above this entry would sweep the delta
      // and restore stale prose onto a row that survives (data-model.md).
      entryId: id,
      actionId: generateId('act'),
      source: 'user_edit',
      target: {
        targetTable: 'story_entries',
        targetId: id,
        op: 'update',
        undoPayload: { content: current.content },
      },
    }),
    ...invalidation.clampOps,
  ])

  entriesStore.patch(branchId, { op: 'update', id, columns: { content } })
  // A second unrelated action clears the redo stack (data-model.md).
  undoRedoStore.clear()
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
): Promise<{ where: SQL | undefined; earliestRemovedPosition: number } | StoryEntryRejection> {
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
    // B: the target is itself the first entry the sweep removes, for both the
    // rollback and the CTRL-Z turn arm.
    earliestRemovedPosition: target.position,
  }
}

/**
 * The rollback window materialized: the delta rows to reverse (log_position DESC,
 * the order reverse-replay requires) plus the watermark clamp that must ride in
 * their transaction. Deliberately side-effect-free — each caller owns its own tail
 * (`countBuckets`, a redo snapshot, nothing) and decides its own redo-stack policy,
 * which is not uniform across callers.
 */
export async function resolveSweep(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<{ rows: Delta[]; clampOps: SqlOp[] } | StoryEntryRejection> {
  const win = await resolveRollbackWindow(branchId, targetId, ctx)
  if ('status' in win) return win
  const rows = (await ctx.db
    .select()
    .from(deltas)
    .where(win.where)
    .orderBy(desc(deltas.logPosition))) as Delta[]
  return { rows, clampOps: classifierWatermarkClampOps(branchId, win.earliestRemovedPosition) }
}

// Buckets per rollback-confirm.md, whose world-state row is scoped to the other
// narrative tables. An entry-scoped delta is spared by the survival anchor unless its
// entry is being deleted, so counting one here would charge the user twice for a loss
// the entries line already reports.
function countBuckets(rows: Pick<Delta, 'op' | 'targetTable'>[]): RollbackCounts {
  let entries = 0
  let chapters = 0
  let worldStateChanges = 0
  for (const r of rows) {
    if (r.targetTable === 'story_entries') {
      if (r.op === 'create') entries++
    } else if (r.op === 'create' && r.targetTable === 'chapters') chapters++
    else worldStateChanges++
  }
  return { entries, chapters, worldStateChanges }
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

  return bracketProseReversal(branchId, async () => {
    const swept = await resolveSweep(branchId, targetId, ctx)
    if ('status' in swept) return swept
    const counts = countBuckets(swept.rows)
    await reverseAndPruneDeltaRows(swept.rows, ctx, swept.clampOps)
    // A second unrelated action clears the redo stack (data-model.md).
    undoRedoStore.clear()
    return { status: 'ok', counts }
  })
}
