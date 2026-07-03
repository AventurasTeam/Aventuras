import { and, eq } from 'drizzle-orm'

import type { Delta } from '@/lib/db'
import { deltas } from '@/lib/db'

import type { DbCtx } from '../types'
import { resolveByTable, type TableDescriptor } from './registry'

export type RedoSnapshot = {
  delta: Delta
  // Full row content captured immediately BEFORE the undo reversal runs — this
  // is the "forward" state redo restores to, since deltas only store the
  // backward (undo_payload) diff, never a forward one.
  rowBeforeUndo: Record<string, unknown> | null
}

function whereForDelta(descriptor: TableDescriptor, delta: Delta) {
  return descriptor.branchCol
    ? and(eq(descriptor.branchCol, delta.branchId), eq(descriptor.idCol, delta.targetId))
    : eq(descriptor.idCol, delta.targetId)
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

// Re-applies the forward state captured in each snapshot and re-inserts the
// original delta row (so a subsequent CTRL-Z can undo the redo again).
export async function applyRedo(snapshots: RedoSnapshot[], ctx: DbCtx): Promise<void> {
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
  for (const { delta, rowBeforeUndo } of snapshots) {
    const entry = resolveByTable(delta.targetTable)
    entry?.patcher?.(
      delta.branchId,
      delta.op === 'create'
        ? { op: 'create', id: delta.targetId, row: rowBeforeUndo ?? {} }
        : delta.op === 'delete'
          ? { op: 'delete', id: delta.targetId }
          : { op: 'update', id: delta.targetId, columns: rowBeforeUndo ?? {} },
    )
  }
}
