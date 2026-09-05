import type { Delta, SqlOp } from '@/lib/db'
import { deltas, isEmbeddedSourceTable } from '@/lib/db'

import type { DbCtx } from '../types'
import { resolveByTable, whereForDelta } from './registry'
import { buildReverseAndPrunePlan, DeltaReplayError, emitPatches } from './reverse-replay'

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

// A whole-row snapshot carries no diff, so redo errs dirty on membership alone; the
// live-row compare would cost a query per delta. Copies — the snapshots outlive this call.
function redoRow(
  delta: Delta,
  rowBeforeUndo: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!rowBeforeUndo || !isEmbeddedSourceTable(delta.targetTable)) return rowBeforeUndo
  return { ...rowBeforeUndo, embeddingStale: 1 }
}

/**
 * Deltas to reverse in the redo's own transaction, plus ops to settle with it. Stays
 * table-agnostic here: the caller decides what a restored row invalidates.
 */
export type RedoInvalidation = { rows: Delta[]; extraOps: readonly SqlOp[] }

const NO_INVALIDATION: RedoInvalidation = { rows: [], extraOps: [] }

// Re-inserts the original delta row so a subsequent CTRL-Z can undo the redo again.
export async function applyRedo(
  snapshots: readonly RedoSnapshot[],
  ctx: DbCtx,
  invalidation: RedoInvalidation = NO_INVALIDATION,
): Promise<void> {
  const ops = []
  const cascadeInfo: Map<string, Record<string, Record<string, unknown>[]>> = new Map()

  for (const { delta, rowBeforeUndo } of snapshots) {
    const entry = resolveByTable(delta.targetTable)
    if (!entry) throw new Error(`redo apply: unknown target_table ${delta.targetTable}`)
    const where = whereForDelta(entry.descriptor, delta)
    const row = redoRow(delta, rowBeforeUndo)

    // A delete needs no row; create and update restore one, and a snapshot that
    // carries none can restore nothing.
    let restored = false
    if (delta.op === 'create') {
      if (row) {
        ops.push(ctx.db.insert(entry.descriptor.table).values(row).toSQL())
        restored = true
      }
    } else if (delta.op === 'delete') {
      if (entry.cascadeDeleteOps) {
        const { ops: childOps, children } = await entry.cascadeDeleteOps(
          delta.branchId,
          delta.targetId,
          ctx,
        )
        ops.push(...childOps)
        cascadeInfo.set(delta.targetId, children)
      }
      ops.push(ctx.db.delete(entry.descriptor.table).where(where).toSQL())
      restored = true
    } else if (row) {
      ops.push(ctx.db.update(entry.descriptor.table).set(row).where(where).toSQL())
      restored = true
    }
    // Inside the guards, not after: a snapshot that wrote nothing would log a restore
    // that never happened, leaving a later CTRL-Z to reverse a row redo never touched.
    if (restored) ops.push(ctx.db.insert(deltas).values(delta).toSQL())
  }
  // Reversal after the redo's own ops: a restore writes the whole row, so a targeted
  // reversal of the same row would be clobbered the other way round. Defensive only —
  // the classifier emits no action targeting story_entries — but not silently so.
  const plan =
    invalidation.rows.length > 0
      ? await buildReverseAndPrunePlan(invalidation.rows, ctx)
      : { ops: [], pruneOps: [], patches: [] }
  // Prunes ahead of the delta re-inserts: the undo freed this snapshot's log
  // positions, and a pass since then may hold one — (branch_id, log_position) is unique.
  await ctx.runInTransaction([...plan.pruneOps, ...ops, ...plan.ops, ...invalidation.extraOps])
  // Past this point the redo is committed; a patcher throw is a store-sync
  // failure, not a redo failure. Flag committed so redoLastAction still pops
  // the (now-applied) snapshot instead of leaving it for a doomed retry.
  try {
    for (const { delta, rowBeforeUndo } of snapshots) {
      const entry = resolveByTable(delta.targetTable)
      const row = redoRow(delta, rowBeforeUndo)
      if (delta.op === 'delete') {
        entry?.patcher?.(delta.branchId, { op: 'delete', id: delta.targetId })
        const children = cascadeInfo.get(delta.targetId)
        if (children) {
          for (const [childTableName, childRows] of Object.entries(children)) {
            const childEntry = resolveByTable(childTableName)
            for (const childRow of childRows) {
              childEntry?.patcher?.(delta.branchId, { op: 'delete', id: childRow.id as string })
            }
          }
        }
      } else if (row) {
        entry?.patcher?.(
          delta.branchId,
          delta.op === 'create'
            ? { op: 'create', id: delta.targetId, row }
            : { op: 'update', id: delta.targetId, columns: row },
        )
      }
      // create/update with no rowBeforeUndo wrote nothing to the DB above; skip
      // the patcher too so the store never gains a phantom row.
    }
    // Last, mirroring the transaction: the reversal ran after the restore, so its
    // patches have to win in the store the same way.
    emitPatches(plan.patches)
  } catch (e) {
    throw new DeltaReplayError('Post-commit redo patch sync failed', {
      cause: e,
      actionId: snapshots[0]?.delta.actionId ?? 'redo',
      committed: true,
    })
  }
}
