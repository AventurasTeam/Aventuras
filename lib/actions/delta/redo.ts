import type { Delta, SqlOp } from '@/lib/db'
import { deltas, isEmbeddedSourceTable } from '@/lib/db'

import type { DbCtx } from '../types'
import { cascadePatches } from './delete-cascade'
import { heldKey } from './held-rows'
import { withKeyLocks } from './key-lock'
import { resolveByTable, whereForDelta } from './registry'
import {
  DeltaReplayError,
  ReversalIntegrityError,
  reverseAndPruneDeltaRows,
} from './reverse-replay'
import type { ReversalSet } from './row-closure'
import { deltaLockKeys } from './row-locks'

export type RedoSnapshot = {
  delta: Delta
  // Full row content captured immediately BEFORE the undo reversal runs — this
  // is the "forward" state redo restores to, since deltas only store the
  // backward (undo_payload) diff, never a forward one.
  rowBeforeUndo: Record<string, unknown> | null
}

/**
 * A CTRL-Z's redo snapshot, minted only by prepareUndo, as ReversalSet is by selectReversalSet:
 * its held-row refusal and its taken-before-the-reversal timing hold for no other producer.
 */
class RedoGroup {
  // A private field makes the type nominal: no literal or spread of a group satisfies it.
  readonly #minted = true
  readonly snapshots: readonly RedoSnapshot[]

  constructor(snapshots: readonly RedoSnapshot[]) {
    this.snapshots = snapshots
  }
}

export type { RedoGroup }

// Test-only: a group no undo took, for a test that needs one on the redo stack.
export function __redoGroupForTest(snapshots: readonly RedoSnapshot[] = []): RedoGroup {
  return new RedoGroup(snapshots)
}

/** A redoable CTRL-Z of a set: the redo group, taken before `reverse` runs the reversal. */
export type PreparedUndo = {
  readonly group: RedoGroup
  /** Reverses and prunes the set, refusing a prune the snapshot could not restore. */
  readonly reverse: (extraOps?: readonly SqlOp[]) => Promise<number>
}

// One call takes the snapshot and fixes keepRedoExact, so the two cannot disagree.
export async function prepareUndo(set: ReversalSet, ctx: DbCtx): Promise<PreparedUndo> {
  const group = new RedoGroup(await snapshotForRedo(set, ctx))
  return {
    group,
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
 * Re-inserts the original delta rows so a subsequent CTRL-Z can undo the redo again.
 * `extraOps` settle in the same transaction; the caller decides what a restored row
 * invalidates.
 */
export function applyRedo(
  group: RedoGroup,
  ctx: DbCtx,
  extraOps: readonly SqlOp[] = [],
): Promise<void> {
  const { snapshots } = group
  const keys = deltaLockKeys(snapshots.map((s) => s.delta))
  return withKeyLocks(keys, () => applyRedoLocked(snapshots, ctx, extraOps))
}

async function applyRedoLocked(
  snapshots: readonly RedoSnapshot[],
  ctx: DbCtx,
  extraOps: readonly SqlOp[],
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
      // Re-logged on the snapshot, not a live-row read: the row is live at redo, or a create
      // in this snapshot re-inserts it whole, and an undo that left it absent was refused.
      ops.push(ctx.db.update(entry.descriptor.table).set(row).where(where).toSQL())
      restored = true
    }
    // Inside the guards, not after: a snapshot that wrote nothing would log a restore
    // that never happened, leaving a later CTRL-Z to reverse a row redo never touched.
    if (restored) restoredDeltas.push(delta)
  }
  // At its own position: every delta-logged write clears the redo stack, so nothing has
  // logged into the slot the undo freed, and log order stays write order
  // (data-model.md -> Entry mutability & rollback).
  const deltaOps = restoredDeltas.map((delta) => ctx.db.insert(deltas).values(delta).toSQL())
  await ctx.runInTransaction([...ops, ...deltaOps, ...extraOps])
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
  } catch (e) {
    throw new DeltaReplayError('Post-commit redo patch sync failed', {
      cause: e,
      actionId: snapshots[0]?.delta.actionId ?? 'redo',
      stage: 'store-sync',
    })
  }
}
