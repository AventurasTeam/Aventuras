import type { Delta, SqlOp } from '@/lib/db'
import { deltas, isEmbeddedSourceTable } from '@/lib/db'

import { isUserOriginatedSource, type DbCtx } from '../types'
import { cascadePatches } from './delete-cascade'
import { nextLogPosition } from './delta-row'
import { heldKey } from './held-rows'
import { withKeyLocks } from './key-lock'
import { resolveByTable, whereForDelta } from './registry'
import {
  buildReverseAndPrunePlan,
  DeltaReplayError,
  emitPatches,
  ReversalIntegrityError,
  reverseAndPruneDeltaRows,
} from './reverse-replay'
import { reversalLockKeys, type ReversalSet } from './row-closure'
import { deltaLockKeys } from './row-locks'
import { FIRST_LOGGED_AT, firstLoggedAt } from './user-precedence'

export type RedoSnapshot = {
  delta: Delta
  // Full row content captured immediately BEFORE the undo reversal runs — this
  // is the "forward" state redo restores to, since deltas only store the
  // backward (undo_payload) diff, never a forward one.
  rowBeforeUndo: Record<string, unknown> | null
}

/** A redoable CTRL-Z of a set: the redo snapshot, taken before `reverse` runs the reversal. */
export type PreparedUndo = {
  readonly snapshot: readonly RedoSnapshot[]
  /** Reverses and prunes the set, refusing a prune the snapshot could not restore. */
  readonly reverse: (extraOps?: readonly SqlOp[]) => Promise<number>
}

// One call takes the snapshot and fixes keepRedoExact, so the two cannot disagree.
export async function prepareUndo(set: ReversalSet, ctx: DbCtx): Promise<PreparedUndo> {
  const snapshot = await snapshotForRedo(set, ctx)
  return {
    snapshot,
    reverse: (extraOps = []) =>
      reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: true }, extraOps),
  }
}

async function snapshotForRedo(set: ReversalSet, ctx: DbCtx): Promise<RedoSnapshot[]> {
  // Redo restores rows to their tables; it cannot put one back into a delete's payload
  // (generation-pipeline.md → Reverse-replay).
  const heldWrite = set.redoRows.find(
    (d) => d.op !== 'delete' && set.held.byRow.has(heldKey(d.targetTable, d.targetId)),
  )
  if (heldWrite) {
    const key = heldKey(heldWrite.targetTable, heldWrite.targetId)
    throw new ReversalIntegrityError(
      'held-in-redo',
      `${key} held by ${set.held.byRow.get(key)?.holder.id}`,
      heldWrite.actionId,
    )
  }
  const snapshots: RedoSnapshot[] = []
  for (const delta of set.redoRows) {
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
 * A closed set to reverse in the redo's own transaction, plus ops to settle with it. Stays
 * table-agnostic here: the caller decides what a restored row invalidates.
 */
export type RedoInvalidation = { set: ReversalSet; extraOps: readonly SqlOp[] }

// Reversal precedence weighs a user write by where it first logged, not the head slot it
// re-logs at, which sits above the machine writes it preceded.
function relogPayload(delta: Delta): Delta['undoPayload'] {
  if (!isUserOriginatedSource(delta.source)) return delta.undoPayload
  return { ...delta.undoPayload, [FIRST_LOGGED_AT]: firstLoggedAt(delta) }
}

// Re-inserts the original delta row so a subsequent CTRL-Z can undo the redo again.
export function applyRedo(
  snapshots: readonly RedoSnapshot[],
  ctx: DbCtx,
  invalidation?: RedoInvalidation,
): Promise<void> {
  const keys = [
    ...deltaLockKeys(snapshots.map((s) => s.delta)),
    ...(invalidation ? reversalLockKeys(invalidation.set) : []),
  ]
  return withKeyLocks(keys, () => applyRedoLocked(snapshots, ctx, invalidation))
}

async function applyRedoLocked(
  snapshots: readonly RedoSnapshot[],
  ctx: DbCtx,
  invalidation: RedoInvalidation | undefined,
): Promise<void> {
  const ops = []
  const restoredDeltas: Delta[] = []
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
      if (entry.cascade) {
        const { ops: childOps, children } = await entry.cascade.run(
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
    if (restored) restoredDeltas.push(delta)
  }
  // Fresh MAX+1, not the slot the undo freed: a pass may hold it, and (branch_id,
  // log_position) is unique. Re-assigning also lands the restore at the log head, so a
  // later CTRL-Z reaches it before anything written in the gap. Ascending because the
  // subquery increments per row while snapshots arrive newest-first
  // (data-model.md -> Entry mutability & rollback).
  restoredDeltas.sort((a, b) => a.logPosition - b.logPosition)
  const deltaOps = restoredDeltas.map((delta) =>
    ctx.db
      .insert(deltas)
      .values({
        ...delta,
        logPosition: nextLogPosition(delta.branchId),
        undoPayload: relogPayload(delta),
      })
      .toSQL(),
  )
  // Reversal after the redo's own ops: a restore writes the whole row, so a targeted
  // reversal of the same row would be clobbered the other way round. Ordered explicitly
  // rather than left to chance -- the classifier targets no story_entries row today.
  const plan =
    invalidation && invalidation.set.rows.length > 0
      ? await buildReverseAndPrunePlan(invalidation.set, ctx, { keepRedoExact: true })
      : { ops: [], pruneOps: [], patches: [] }
  // Prunes ahead of the re-inserts so the restored deltas take positions above what
  // survives the reversal rather than above rows this transaction is deleting.
  await ctx.runInTransaction([
    ...plan.pruneOps,
    ...ops,
    ...deltaOps,
    ...plan.ops,
    ...(invalidation?.extraOps ?? []),
  ])
  // Past this point the redo is committed, so a patcher throw is a store-sync failure:
  // redoLastAction still pops the (now-applied) snapshot instead of leaving it for a doomed retry.
  try {
    for (const { delta, rowBeforeUndo } of snapshots) {
      const entry = resolveByTable(delta.targetTable)
      const row = redoRow(delta, rowBeforeUndo)
      if (delta.op === 'delete') {
        entry?.patcher?.(delta.branchId, { op: 'delete', id: delta.targetId })
        const children = cascadeInfo.get(delta.targetId)
        if (children) {
          for (const { table, patch } of cascadePatches(children)) {
            resolveByTable(table)?.patcher?.(delta.branchId, patch)
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
      stage: 'store-sync',
    })
  }
}
