import type { Delta, SqlOp } from '@/lib/db'
import { deltas, isEmbeddedSourceTable } from '@/lib/db'

import type { DbCtx } from '../types'
import { cascadePatches } from './delete-cascade'
import { heldKey, type HeldKey } from './held-rows'
import { withKeyLocks } from './key-lock'
import { absentRefs, pathRefIds, type LiveRef, type RefPath } from './live-refs'
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

/** A ref the undo cleared, with the id it held before the undo. */
export type RefRestore = {
  readonly branchId: string
  readonly row: RowRef
  readonly ref: RefPath
  readonly idBeforeUndo: string | null
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

// A clear through a row only a sweep removes stays: redo leaves that row to re-derive. A row a
// snapshot restores whole gets its ref back with it.
function clearsRedoRestores(set: ReversalSet): RefClear[] {
  const recreated = new Set(
    set.redoRows.filter((d) => d.op === 'create').map((d) => heldKey(d.targetTable, d.targetId)),
  )
  const snapshotted = new Set(set.redoRows.map((d) => heldKey(d.targetTable, d.targetId)))
  return set.refClears.filter(
    (c) =>
      recreated.has(heldKey(c.ref.refTable, c.removedId)) &&
      !snapshotted.has(heldKey(c.row.table, c.row.id)),
  )
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
    // Neither live nor held: the planner clears nothing there, so nothing goes back.
    if (before) {
      const id = pathRefIds(row.table, before).find((p) => p.ref.path === ref.path)?.id ?? null
      refRestores.push({ branchId: set.branchId, row, ref, idBeforeUndo: id })
    }
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

type RestoredRow = { snapshot: RedoSnapshot; row: Record<string, unknown> | null }

// generation-pipeline.md → Reverse-replay: a redo never leaves a ref naming a row that doesn't exist.
// A ref restore needs no check: it exists only for a row this redo re-creates.
async function deadAfterRedo(
  ctx: DbCtx,
  restoredRows: readonly RestoredRow[],
): Promise<Set<HeldKey>> {
  const recreated = new Set<HeldKey>()
  const dead = new Set<HeldKey>()
  for (const { snapshot, row } of restoredRows) {
    const key = heldKey(snapshot.delta.targetTable, snapshot.delta.targetId)
    if (snapshot.delta.op === 'create' && row) recreated.add(key)
    if (snapshot.delta.op === 'delete') dead.add(key)
  }
  const named = new Map<string, LiveRef[]>()
  for (const { snapshot, row } of restoredRows) {
    if (!row || snapshot.delta.op === 'delete') continue
    const refs = named.get(snapshot.delta.branchId) ?? []
    for (const { ref, id } of pathRefIds(snapshot.delta.targetTable, row))
      if (id !== null && !recreated.has(heldKey(ref.refTable, id)))
        refs.push({ table: ref.refTable, id })
    named.set(snapshot.delta.branchId, refs)
  }
  for (const [branchId, refs] of named)
    for (const { table, id } of await absentRefs(ctx, branchId, refs)) dead.add(heldKey(table, id))
  return dead
}

function withoutDeadRefs(
  table: string,
  row: Record<string, unknown> | null,
  dead: ReadonlySet<HeldKey>,
): Record<string, unknown> | null {
  if (!row) return row
  let out = row
  for (const { ref, id } of pathRefIds(table, row)) {
    if (id === null || !dead.has(heldKey(ref.refTable, id))) continue
    out = { ...out, [ref.column]: { ...(out[ref.column] as object), [ref.path]: null } }
  }
  return out
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
  const restoredRows = snapshots.map((snapshot) => ({
    snapshot,
    row: redoRow(snapshot.delta, snapshot.rowBeforeUndo),
  }))
  const dead = await deadAfterRedo(ctx, restoredRows)
  for (const restoredRow of restoredRows)
    restoredRow.row = withoutDeadRefs(restoredRow.snapshot.delta.targetTable, restoredRow.row, dead)

  for (const { snapshot, row } of restoredRows) {
    const { delta } = snapshot
    const entry = resolveByTable(delta.targetTable)
    if (!entry) throw new Error(`redo apply: unknown target_table ${delta.targetTable}`)
    const where = whereForDelta(entry.descriptor, delta)

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
  // Read under the key locks: only the ref goes back, over the column as the undo left it.
  const refPatches: { row: RowRef; branchId: string; columns: Record<string, unknown> }[] = []
  for (const { branchId, row, ref, idBeforeUndo } of refRestores) {
    const entry = resolveByTable(row.table)
    if (!entry) throw new Error(`redo apply: unknown target_table ${row.table}`)
    const current = await currentRow(ctx, row.table, { branchId, targetId: row.id })
    if (!current) continue
    const columns = {
      [ref.column]: { ...(current[ref.column] as object), [ref.path]: idBeforeUndo },
    }
    ops.push(
      ctx.db
        .update(entry.descriptor.table)
        .set(columns)
        .where(whereForDelta(entry.descriptor, { branchId, targetId: row.id }))
        .toSQL(),
    )
    refPatches.push({ row, branchId, columns })
  }
  await ctx.runInTransaction([...ops, ...deltaOps, ...extraOps])
  // Past this point the redo is committed, so a patcher throw is a store-sync failure:
  // redoLastAction still pops the (now-applied) snapshot instead of leaving it for a doomed retry.
  try {
    for (const { snapshot, row } of restoredRows) {
      const { delta } = snapshot
      const entry = resolveByTable(delta.targetTable)
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
    for (const { row, branchId, columns } of refPatches)
      resolveByTable(row.table)?.patcher?.(branchId, { op: 'update', id: row.id, columns })
  } catch (e) {
    throw new DeltaReplayError('Post-commit redo patch sync failed', {
      cause: e,
      actionId: snapshots[0]?.delta.actionId ?? 'redo',
      stage: 'store-sync',
    })
  }
}
