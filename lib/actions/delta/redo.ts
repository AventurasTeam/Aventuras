import type { Delta, SqlOp } from '@/lib/db'
import { deltas, isEmbeddedSourceTable } from '@/lib/db'

import type { DbCtx } from '../types'
import { cascadePatches } from './delete-cascade'
import { heldKey } from './held-rows'
import { withKeyLocks } from './key-lock'
import type { RefPath } from './live-refs'
import { resolveByTable, whereForDelta } from './registry'
import {
  DeltaReplayError,
  ReversalIntegrityError,
  reverseAndPruneDeltaRows,
} from './reverse-replay'
import type { RefClear, ReversalSet, RowRef } from './row-closure'
import { deltaLockKeys } from './row-locks'

export type RedoSnapshot = {
  delta: Delta
  // Full row content captured immediately BEFORE the undo reversal runs — this
  // is the "forward" state redo restores to, since deltas only store the
  // backward (undo_payload) diff, never a forward one.
  rowBeforeUndo: Record<string, unknown> | null
}

/** The column of a row whose ref the undo cleared, as it stood before the undo. */
export type RefRestore = {
  readonly branchId: string
  readonly row: RowRef
  readonly column: RefPath['column']
  readonly valueBeforeUndo: unknown
}

/**
 * A CTRL-Z's redo snapshot, minted only by prepareUndo, as ReversalSet is by selectReversalSet:
 * its held-row refusal and its taken-before-the-reversal timing hold for no other producer.
 */
class RedoGroup {
  // A private field makes the type nominal: no literal or spread of a group satisfies it.
  readonly #minted = true
  readonly snapshots: readonly RedoSnapshot[]
  /** The clears of refs to a row the snapshot re-creates; redo writes each back, logging nothing. */
  readonly refRestores: readonly RefRestore[]

  constructor(snapshots: readonly RedoSnapshot[], refRestores: readonly RefRestore[]) {
    this.snapshots = snapshots
    this.refRestores = refRestores
  }
}

export type { RedoGroup }

// Test-only: a group no undo took, for a test that needs one on the redo stack.
export function __redoGroupForTest(snapshots: readonly RedoSnapshot[] = []): RedoGroup {
  return new RedoGroup(snapshots, [])
}

/** A redoable CTRL-Z of a set: the redo group, taken before `reverse` runs the reversal. */
export type PreparedUndo = {
  readonly group: RedoGroup
  /** Reverses and prunes the set, refusing a prune the snapshot could not restore. */
  readonly reverse: (extraOps?: readonly SqlOp[]) => Promise<number>
}

// One call takes the snapshot and fixes keepRedoExact, so the two cannot disagree.
export async function prepareUndo(set: ReversalSet, ctx: DbCtx): Promise<PreparedUndo> {
  const group = await snapshotForRedo(set, ctx)
  return {
    group,
    reverse: (extraOps = []) =>
      reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: true }, extraOps),
  }
}

function heldInRedo(set: ReversalSet, row: RowRef, actionId: string): ReversalIntegrityError {
  const key = heldKey(row.table, row.id)
  return new ReversalIntegrityError(
    'held-in-redo',
    `${key} held by ${set.held.byRow.get(key)?.holder.id}`,
    actionId,
  )
}

async function currentRow(
  ctx: DbCtx,
  table: string,
  row: Pick<Delta, 'branchId' | 'targetId'>,
): Promise<Record<string, unknown> | null> {
  const entry = resolveByTable(table)
  if (!entry) throw new Error(`redo snapshot: unknown target_table ${table}`)
  const found = (await ctx.db
    .select()
    .from(entry.descriptor.table)
    .where(whereForDelta(entry.descriptor, row))) as Record<string, unknown>[]
  return found[0] ?? null
}

// A clear through a row only a sweep removes stays: redo leaves that row to re-derive.
function clearsRedoRestores(set: ReversalSet): RefClear[] {
  const recreated = new Set(
    set.redoRows.filter((d) => d.op === 'create').map((d) => heldKey(d.targetTable, d.targetId)),
  )
  return set.refClears.filter((c) => recreated.has(heldKey(c.ref.refTable, c.removedId)))
}

async function snapshotForRedo(set: ReversalSet, ctx: DbCtx): Promise<RedoGroup> {
  // Redo restores rows to their tables; it cannot put one back into a delete's payload
  // (generation-pipeline.md → Reverse-replay).
  const heldWrite = set.redoRows.find(
    (d) => d.op !== 'delete' && set.held.byRow.has(heldKey(d.targetTable, d.targetId)),
  )
  if (heldWrite)
    throw heldInRedo(
      set,
      { table: heldWrite.targetTable, id: heldWrite.targetId },
      heldWrite.actionId,
    )
  const restored = clearsRedoRestores(set)
  const heldClear = restored.find(({ row }) => set.held.byRow.has(heldKey(row.table, row.id)))
  if (heldClear) throw heldInRedo(set, heldClear.row, set.redoRows[0]?.actionId ?? 'redo')
  const snapshots: RedoSnapshot[] = []
  for (const delta of set.redoRows) {
    snapshots.push({ delta, rowBeforeUndo: await currentRow(ctx, delta.targetTable, delta) })
  }
  const refRestores: RefRestore[] = []
  for (const { row, ref } of restored) {
    const before = await currentRow(ctx, row.table, { branchId: set.branchId, targetId: row.id })
    // The planner clears no row it finds absent, so there is nothing to put back.
    if (before)
      refRestores.push({
        branchId: set.branchId,
        row,
        column: ref.column,
        valueBeforeUndo: before[ref.column],
      })
  }
  return new RedoGroup(snapshots, refRestores)
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
  const { snapshots, refRestores } = group
  const keys = deltaLockKeys([
    ...snapshots.map((s) => s.delta),
    ...refRestores.map(({ branchId, row }) => ({
      branchId,
      targetTable: row.table,
      targetId: row.id,
    })),
  ])
  return withKeyLocks(keys, () => applyRedoLocked(snapshots, refRestores, ctx, extraOps))
}

async function applyRedoLocked(
  snapshots: readonly RedoSnapshot[],
  refRestores: readonly RefRestore[],
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
  for (const { branchId, row, column, valueBeforeUndo } of refRestores) {
    const entry = resolveByTable(row.table)
    if (!entry) throw new Error(`redo apply: unknown target_table ${row.table}`)
    ops.push(
      ctx.db
        .update(entry.descriptor.table)
        .set({ [column]: valueBeforeUndo })
        .where(whereForDelta(entry.descriptor, { branchId, targetId: row.id }))
        .toSQL(),
    )
  }
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
    for (const { branchId, row, column, valueBeforeUndo } of refRestores)
      resolveByTable(row.table)?.patcher?.(branchId, {
        op: 'update',
        id: row.id,
        columns: { [column]: valueBeforeUndo },
      })
  } catch (e) {
    throw new DeltaReplayError('Post-commit redo patch sync failed', {
      cause: e,
      actionId: snapshots[0]?.delta.actionId ?? 'redo',
      stage: 'store-sync',
    })
  }
}
