import { desc, eq } from 'drizzle-orm'

import type { Delta, SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { resolveInvalidationForDeltas, type InvalidationOutcome } from './classifier-facts'
import { logReversalRefused, resolveSweep } from './operational'
import { bracketProseReversal } from './prose-reversal'
import { applyRedo, prepareUndo, type RedoSnapshot } from '../delta/redo'
import { DeltaReplayError, ReversalIntegrityError } from '../delta/reverse-replay'
import { selectReversalSet, type ReversalSet } from '../delta/row-closure'
import type { DbCtx } from '../types'

/**
 * Why an undo/redo was refused. `reason` stays free-form for the log line; only `code`
 * is branched on: a surface must tell a routine refusal from a delta log that cannot
 * produce the reversal it should, which must not read as "Nothing to undo".
 */
export type UndoRejectionCode = 'gated' | 'branch-not-loaded' | 'nothing-to-apply' | 'integrity'

export type UndoResult =
  | { status: 'ok' }
  | { status: 'rejected'; code: UndoRejectionCode; reason: string }

function unreadableScopeRejection(deltaId: string): UndoResult {
  return {
    status: 'rejected',
    code: 'integrity',
    reason: `delta ${deltaId} carries an unreadable invalidation scope`,
  }
}

// A refused reversal wrote nothing, and the log cannot produce the reversal it should
// (generation-pipeline.md → Reverse-replay).
async function refusingIntegrity(
  branchId: string,
  body: () => Promise<UndoResult>,
): Promise<UndoResult> {
  try {
    return await body()
  } catch (e) {
    if (!(e instanceof ReversalIntegrityError)) throw e
    logReversalRefused(branchId, e)
    return { status: 'rejected', code: 'integrity', reason: e.message }
  }
}

async function recentDeltaRows(branchId: string, ctx: DbCtx): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, branchId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

export async function undoLastAction(branchId: string, ctx: DbCtx): Promise<UndoResult> {
  if (generationStore.isUserEditBlocked())
    return { status: 'rejected', code: 'gated', reason: 'generation in flight' }
  // The reader screen only ever calls this for the branch it has loaded; a
  // stale branchId (e.g. mid branch-switch) would otherwise let the reversal
  // race the in-flight reload that's about to hydrate the same branch.
  if (entriesStore.getLoadedBranch() !== branchId)
    return { status: 'rejected', code: 'branch-not-loaded', reason: 'branch not loaded' }

  // Brackets the whole target-selection + reversal sweep, matching
  // rollbackToEntry — a concurrent edit/submit/generation mid-sweep must not
  // race the rows this undo is about to read and reverse.
  return bracketProseReversal(branchId, () =>
    refusingIntegrity(branchId, () => undoBracketed(branchId, ctx)),
  )
}

async function undoBracketed(branchId: string, ctx: DbCtx): Promise<UndoResult> {
  const recent = await recentDeltaRows(branchId, ctx)
  const target = selectUndoTarget(recent)
  if (!target) return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to undo' }

  let set: ReversalSet
  let clampOps: SqlOp[]
  if (target.kind === 'turn') {
    const swept = await resolveSweep(branchId, target.entryId, ctx)
    // A missing entry or create delta, or a refused closure (the only one logged): unreversible.
    if ('status' in swept) return { status: 'rejected', code: 'integrity', reason: swept.reason }
    set = swept.set
    clampOps = swept.clampOps
  } else {
    const group = recent.filter((r) => r.actionId === target.actionId)
    const invalidation = await resolveInvalidationForDeltas(branchId, group, ctx)
    if (invalidation.status === 'unreadable') return unreadableScopeRejection(invalidation.deltaId)
    clampOps = invalidation.clampOps
    // Swept facts follow from the prose moving, not from the action: as `sweep` they stay out
    // of redo, and the clamped watermark re-derives them (generation-pipeline.md → Reverse-replay).
    set = await selectReversalSet(ctx, { branchId, target: group, sweep: invalidation.rows })
  }

  // Redo restores the target and its closure (data-model.md → Entry mutability & rollback).
  const undo = await prepareUndo(set, ctx)
  try {
    await undo.reverse(clampOps)
  } catch (e) {
    // Committed: the reversal + prune landed in SQLite, only the store sync failed. The change
    // is real, so keep redo available before surfacing the failure.
    if (e instanceof DeltaReplayError && e.committed) undoRedoStore.pushRedoGroup(undo.group)
    throw e
  }
  undoRedoStore.pushRedoGroup(undo.group)
  return { status: 'ok' }
}

export async function redoLastAction(branchId: string, ctx: DbCtx): Promise<UndoResult> {
  if (generationStore.isUserEditBlocked())
    return { status: 'rejected', code: 'gated', reason: 'generation in flight' }
  if (entriesStore.getLoadedBranch() !== branchId)
    return { status: 'rejected', code: 'branch-not-loaded', reason: 'branch not loaded' }

  const group = undoRedoStore.peekRedoGroup()
  if (!group) return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to redo' }
  // The redo stack is a single global stack, not partitioned per branch. Guard
  // against applying another branch's snapshot to this context.
  if (group.snapshots.some((s) => s.delta.branchId !== branchId))
    return {
      status: 'rejected',
      code: 'integrity',
      reason: 'redo stack does not belong to this branch',
    }

  // A redo restores prose and reverses classifier output, so it drains an in-flight
  // pass the way every other reversal does.
  return bracketProseReversal(branchId, () =>
    refusingIntegrity(branchId, async () => {
      // A write committing during the drain clears the stack; its snapshot would restore over it.
      if (undoRedoStore.peekRedoGroup() !== group)
        return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to redo' }
      const invalidation = await resolveRedoInvalidation(branchId, group.snapshots, ctx)
      if (invalidation.status === 'unreadable')
        return unreadableScopeRejection(invalidation.deltaId)
      try {
        await applyRedo(group, ctx, invalidation.clampOps)
      } catch (e) {
        // Committed: the redo's DB write landed, only the store sync failed. Pop regardless —
        // a retry would re-insert an already-inserted delta row and collide on its primary key.
        if (e instanceof DeltaReplayError && e.committed) undoRedoStore.popRedoGroup()
        throw e
      }
      undoRedoStore.popRedoGroup()
      return { status: 'ok' }
    }),
  )
}

/**
 * Restoring prose re-opens the question the forward edit answered, so the redo re-clamps
 * the watermark: a pass that found nothing advanced it without logging, which leaves the
 * redo stack standing. Its `rows` go unused: a pass that logged a fact cleared the stack,
 * and the undo already swept the rest.
 *
 * Skips a snapshot carrying no row because `isContentEditDelta` pins `op = 'update'`,
 * and `applyRedo` writes nothing for an update it has no row to restore. A delete
 * redoes regardless of the snapshot, so widening the predicate would lose the clamp.
 */
async function resolveRedoInvalidation(
  branchId: string,
  snapshot: readonly RedoSnapshot[],
  ctx: DbCtx,
): Promise<InvalidationOutcome> {
  const restorable = snapshot.filter((s) => s.rowBeforeUndo != null).map((s) => s.delta)
  return resolveInvalidationForDeltas(branchId, restorable, ctx)
}
