import { desc, eq } from 'drizzle-orm'

import type { Delta, SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { resolveGroupInvalidation, sortForReplay } from './classifier-facts'
import { resolveSweep } from './operational'
import { bracketProseReversal } from './prose-reversal'
import { applyRedo, snapshotForRedo } from '../delta/redo'
import { DeltaReplayError, reverseAndPruneDeltaRows } from '../delta/reverse-replay'
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

// The two sets are disjoint by source today; deduping keeps a future overlap from
// reversing a row twice rather than relying on that.
function dedupeById(rows: readonly Delta[]): Delta[] {
  return [...new Map(rows.map((r) => [r.id, r])).values()]
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
  return bracketProseReversal(branchId, async () => {
    const recent = await recentDeltaRows(branchId, ctx)
    const target = selectUndoTarget(recent)
    if (!target) return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to undo' }

    let rows: Delta[]
    // What redo replays. It diverges from `rows` on a content edit — see below.
    let snapshotRows: Delta[]
    let clampOps: SqlOp[] = []
    if (target.kind === 'turn') {
      const swept = await resolveSweep(branchId, target.entryId, ctx)
      // resolveSweep refuses on a missing entry or an absent create delta: the
      // log cannot describe what it is being asked to reverse.
      if ('status' in swept) return { status: 'rejected', code: 'integrity', reason: swept.reason }
      rows = swept.rows
      snapshotRows = rows
      clampOps = swept.clampOps
    } else {
      const group = recent.filter((r) => r.actionId === target.actionId)
      const invalidation = await resolveGroupInvalidation(branchId, group, ctx)
      clampOps = invalidation.clampOps
      // The added reversals are a consequence of the prose moving, not part of the
      // action being undone — so redo replays the group alone. Replaying them too
      // would re-insert rows the redo arm's own invalidation is deleting, and the
      // watermark stays clamped either way, so the next pass re-derives them.
      snapshotRows = group
      rows = sortForReplay(dedupeById([...group, ...invalidation.rows]))
    }

    const snapshot = await snapshotForRedo(snapshotRows, ctx)
    try {
      await reverseAndPruneDeltaRows(rows, ctx, clampOps)
    } catch (e) {
      // A committed DeltaReplayError means the reversal + prune already landed in
      // SQLite; only the post-commit store sync failed. The data change is real,
      // so preserve redo capability before surfacing the sync failure.
      if (e instanceof DeltaReplayError && e.committed) undoRedoStore.pushRedoGroup(snapshot)
      throw e
    }
    undoRedoStore.pushRedoGroup(snapshot)
    return { status: 'ok' }
  })
}

export async function redoLastAction(branchId: string, ctx: DbCtx): Promise<UndoResult> {
  if (generationStore.isUserEditBlocked())
    return { status: 'rejected', code: 'gated', reason: 'generation in flight' }
  if (entriesStore.getLoadedBranch() !== branchId)
    return { status: 'rejected', code: 'branch-not-loaded', reason: 'branch not loaded' }

  const snapshot = undoRedoStore.peekRedoGroup()
  if (!snapshot) return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to redo' }
  // The redo stack is a single global stack, not partitioned per branch. Guard
  // against applying another branch's snapshot to this context.
  if (snapshot.some((s) => s.delta.branchId !== branchId))
    return {
      status: 'rejected',
      code: 'integrity',
      reason: 'redo stack does not belong to this branch',
    }

  generationStore.setReversalInProgress(true)
  try {
    await applyRedo(snapshot, ctx)
  } catch (e) {
    // Committed means the redo's DB write landed; only the post-commit store
    // sync failed. Pop the snapshot regardless — retrying it would re-insert
    // an already-inserted delta row and collide on its primary key.
    if (e instanceof DeltaReplayError && e.committed) undoRedoStore.popRedoGroup()
    throw e
  } finally {
    generationStore.setReversalInProgress(false)
  }
  undoRedoStore.popRedoGroup()
  return { status: 'ok' }
}
