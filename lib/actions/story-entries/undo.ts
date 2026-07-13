import { desc, eq } from 'drizzle-orm'

import type { Delta } from '@/lib/db'
import { deltas } from '@/lib/db'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { applyRedo, snapshotForRedo } from '../delta/redo'
import { DeltaReplayError, reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import type { DbCtx } from '../types'
import { resolveRollbackWindow } from './operational'

export type UndoResult = { status: 'ok' } | { status: 'rejected'; reason: string }

async function recentDeltaRows(branchId: string, ctx: DbCtx): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, branchId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

export async function undoLastAction(branchId: string, ctx: DbCtx): Promise<UndoResult> {
  if (generationStore.isUserEditBlocked())
    return { status: 'rejected', reason: 'generation in flight' }
  // The reader screen only ever calls this for the branch it has loaded; a
  // stale branchId (e.g. mid branch-switch) would otherwise let the reversal
  // race the in-flight reload that's about to hydrate the same branch.
  if (entriesStore.getLoadedBranch() !== branchId)
    return { status: 'rejected', reason: 'branch not loaded' }

  // Brackets the whole target-selection + reversal sweep, matching
  // rollbackToEntry — a concurrent edit/submit/generation mid-sweep must not
  // race the rows this undo is about to read and reverse.
  generationStore.setReversalInProgress(true)
  try {
    const recent = await recentDeltaRows(branchId, ctx)
    const target = selectUndoTarget(recent)
    if (!target) return { status: 'rejected', reason: 'nothing to undo' }

    let rows: Delta[]
    if (target.kind === 'turn') {
      const win = await resolveRollbackWindow(branchId, target.entryId, ctx)
      if ('status' in win) return { status: 'rejected', reason: win.reason }
      rows = (await ctx.db
        .select()
        .from(deltas)
        .where(win.where)
        .orderBy(desc(deltas.logPosition))) as Delta[]
    } else {
      rows = recent.filter((r) => r.actionId === target.actionId)
    }

    const snapshot = await snapshotForRedo(rows, ctx)
    try {
      await reverseAndPruneDeltaRows(rows, ctx)
    } catch (e) {
      // A committed DeltaReplayError means the reversal + prune already landed in
      // SQLite; only the post-commit store sync failed. The data change is real,
      // so preserve redo capability before surfacing the sync failure.
      if (e instanceof DeltaReplayError && e.committed) undoRedoStore.pushRedoGroup(snapshot)
      throw e
    }
    undoRedoStore.pushRedoGroup(snapshot)
    return { status: 'ok' }
  } finally {
    generationStore.setReversalInProgress(false)
  }
}

export async function redoLastAction(branchId: string, ctx: DbCtx): Promise<UndoResult> {
  if (generationStore.isUserEditBlocked())
    return { status: 'rejected', reason: 'generation in flight' }
  if (entriesStore.getLoadedBranch() !== branchId)
    return { status: 'rejected', reason: 'branch not loaded' }

  const snapshot = undoRedoStore.peekRedoGroup()
  if (!snapshot) return { status: 'rejected', reason: 'nothing to redo' }
  // The redo stack is a single global stack, not partitioned per branch. Guard
  // against applying another branch's snapshot to this context.
  if (snapshot.some((s) => s.delta.branchId !== branchId))
    return { status: 'rejected', reason: 'redo stack does not belong to this branch' }

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
