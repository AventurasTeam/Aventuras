import type { Delta } from '@/lib/db'
import { deltas } from '@/lib/db'

import type { DbCtx } from '../types'
import { resolveByTable, whereForDelta } from './registry'
import { DeltaReplayError } from './reverse-replay'

export type RedoSnapshot = {
  delta: Delta
  // Full row content captured immediately BEFORE the undo reversal runs — this
  // is the "forward" state redo restores to, since deltas only store the
  // backward (undo_payload) diff, never a forward one.
  rowBeforeUndo: Record<string, unknown> | null
}

// Call this BEFORE reverseAndPruneDeltaRows/reverseReplayDeltas executes on `rows`.
export async function snapshotForRedo(rows: Delta[], ctx: DbCtx): Promise<RedoSnapshot[]> {
  const snapshots: RedoSnapshot[] = []
  for (const delta of rows) {
    const entry = resolveByTable(delta.targetTable)
    if (!entry) throw new Error(`redo snapshot: unknown target_table ${delta.targetTable}`)
    const found = (await ctx.db
      .select()
      .from(entry.descriptor.table)
      .where(whereForDelta(entry.descriptor, delta))) as Record<string, unknown>[]
    snapshots.push({ delta, rowBeforeUndo: found[0] ?? null })
  }
  return snapshots
}

// Re-inserts the original delta row so a subsequent CTRL-Z can undo the redo again.
export async function applyRedo(snapshots: readonly RedoSnapshot[], ctx: DbCtx): Promise<void> {
  const ops = []
  for (const { delta, rowBeforeUndo } of snapshots) {
    const entry = resolveByTable(delta.targetTable)
    if (!entry) throw new Error(`redo apply: unknown target_table ${delta.targetTable}`)
    const where = whereForDelta(entry.descriptor, delta)

    if (delta.op === 'create') {
      if (rowBeforeUndo)
        ops.push(ctx.db.insert(entry.descriptor.table).values(rowBeforeUndo).toSQL())
    } else if (delta.op === 'delete') {
      ops.push(ctx.db.delete(entry.descriptor.table).where(where).toSQL())
    } else if (rowBeforeUndo) {
      ops.push(ctx.db.update(entry.descriptor.table).set(rowBeforeUndo).where(where).toSQL())
    }
    ops.push(ctx.db.insert(deltas).values(delta).toSQL())
  }
  await ctx.runInTransaction(ops)
  // Past this point the redo is committed; a patcher throw is a store-sync
  // failure, not a redo failure. Flag committed so redoLastAction still pops
  // the (now-applied) snapshot instead of leaving it for a doomed retry.
  try {
    for (const { delta, rowBeforeUndo } of snapshots) {
      const entry = resolveByTable(delta.targetTable)
      if (delta.op === 'delete') {
        entry?.patcher?.(delta.branchId, { op: 'delete', id: delta.targetId })
      } else if (rowBeforeUndo) {
        entry?.patcher?.(
          delta.branchId,
          delta.op === 'create'
            ? { op: 'create', id: delta.targetId, row: rowBeforeUndo }
            : { op: 'update', id: delta.targetId, columns: rowBeforeUndo },
        )
      }
      // create/update with no rowBeforeUndo wrote nothing to the DB above; skip
      // the patcher too so the store never gains a phantom row.
    }
  } catch (e) {
    throw new DeltaReplayError('Post-commit redo patch sync failed', {
      cause: e,
      actionId: snapshots[0]?.delta.actionId ?? 'redo',
      committed: true,
    })
  }
}
