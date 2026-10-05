import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm'
import type { ZodType } from 'zod'

import type { Delta, SqlOp } from '@/lib/db'
import {
  BIND_CHUNK,
  deltas,
  embeddedFieldsForTable,
  isEmbeddedSourceTable,
  rowsPerInsert,
} from '@/lib/db'

import type { DbCtx } from '../types'
import { capturedChildren, vecSweepIdsOps, vecTableLister } from './delete-cascade'
import { applyUndoPayload, isPayloadMetaKey } from './delta-encoding'
import { heldKey, type HeldRow } from './held-rows'
import { withKeyLocks } from './key-lock'
import { liveLinkFilter } from './live-link-filter'
import { resolveByTable, whereForDelta, type StorePatch } from './registry'
import { DeltaReplayError, ReversalIntegrityError } from './replay-errors'
import {
  reversalLockKeys,
  selectReversalSet,
  writesTo,
  type ReversalSet,
  type RowRef,
} from './row-closure'
import { userEditsOutliving, wroteColumn } from './user-precedence'

export {
  DeltaReplayError,
  ReversalIntegrityError,
  type IntegrityRefusal,
  type ReplayFailureStage,
} from './replay-errors'

/** What the pipeline port needs from a replay failure; `undefined` hands any other error back. */
export function describeDeltaReplayError(
  e: unknown,
): { detail: string; committed: boolean } | undefined {
  return e instanceof DeltaReplayError
    ? { detail: String(e.cause), committed: e.committed }
    : undefined
}

export type PatchEmission = { table: string; branchId: string; patch: StorePatch }

/** Required, so a reversal that must keep redo exact cannot get the prune by omission. */
export type ReversalOptions = {
  /** CTRL-Z and redo: refuse a prune of writes outside the set, which redo cannot restore. */
  keepRedoExact: boolean
}

export type ReversePlan = {
  /** The undos' row writes, and one `undo_payload` write per held delete they change. */
  ops: SqlOp[]
  /**
   * One log write per delta in the set (its prune, or the re-own of a create whose row stays),
   * the prune of each delete outside it whose own row the reversal removes, and the prune of
   * every other write to a row-keeping row the reversal leaves absent.
   */
  pruneOps: SqlOp[]
  patches: PatchEmission[]
}

/**
 * The reversal of a closed set, unexecuted — so a caller that owns a transaction of its
 * own can commit it alongside its own work rather than in a second one. Ops and prunes
 * stay separate because their order relative to the caller's ops is the caller's call.
 * A delete whose own row the reversal removes is pruned with the set
 * (generation-pipeline.md → Reverse-replay). The prunes leave gaps in log_position.
 */
export async function buildReverseAndPrunePlan(
  set: ReversalSet,
  ctx: DbCtx,
  options: ReversalOptions,
): Promise<ReversePlan> {
  const built = await buildUndoOps(set, ctx, options)
  const reownOrPrune = (r: Delta): SqlOp => {
    const keptBy = built.reowned.get(r.id)
    return keptBy === undefined
      ? ctx.db.delete(deltas).where(eq(deltas.id, r.id)).toSQL()
      : ctx.db
          .update(deltas)
          .set({ source: 'user_edit', entryId: null, actionId: keptBy })
          .where(eq(deltas.id, r.id))
          .toSQL()
  }
  return {
    ops: built.ops,
    pruneOps: [...set.rows, ...built.prunedHolders, ...built.strandedWrites].map(reownOrPrune),
    patches: built.patches,
  }
}

export function emitPatches(patches: readonly PatchEmission[]): void {
  for (const p of patches) resolveByTable(p.table)?.patcher?.(p.branchId, p.patch)
}

function emitCommittedPatches(patches: readonly PatchEmission[], actionId: string): void {
  try {
    emitPatches(patches)
  } catch (e) {
    throw new DeltaReplayError('Post-commit patch sync failed', {
      cause: e,
      actionId,
      stage: 'store-sync',
    })
  }
}

// Membership only, never a value compare: an undo restores a prior value by
// construction, and a degenerate value-equal undo costs one revalidation hash.
function undoDirtiesVector(targetTable: string, payloadKeys: readonly string[]): boolean {
  const fields = embeddedFieldsForTable(targetTable)
  return fields !== undefined && payloadKeys.some((key) => fields.includes(key))
}

type HeldCopy = {
  readonly held: HeldRow
  /** The held row with the undos applied so far; written back into the holder's payload. */
  readonly row: Record<string, unknown>
  /** Stripped from the payload (captured), or pruning the holder (target). */
  removed: boolean
}

type BuiltUndo = {
  ops: SqlOp[]
  patches: PatchEmission[]
  /** Kept create's delta id → the action of the oldest user write that kept its row. */
  reowned: Map<string, string>
  prunedHolders: Delta[]
  /** Writes outside the set to a row-keeping row the reversal leaves absent. */
  strandedWrites: Delta[]
}

// A null partial on a schema-backed column means the column itself was null pre-change — no
// field-wise overlay can express that, so it takes the whole-value restore a scalar column takes.
function undoneValue(schema: ZodType | undefined, partial: unknown, current: unknown): unknown {
  return schema && partial !== null
    ? applyUndoPayload(
        schema,
        (current as Record<string, unknown>) ?? {},
        partial as Record<string, unknown>,
      )
    : partial
}

function rebuiltPayload(holder: Delta, copies: readonly HeldCopy[]): Record<string, unknown> {
  const original = holder.undoPayload ?? {}
  const target = copies.find((c) => c.held.place === 'target')
  const payload: Record<string, unknown> = { ...original, ...target?.row }
  const byRow = new Map(copies.map((c) => [heldKey(c.held.table, c.held.id), c]))
  const { children, cascadeKeys } = capturedChildren(
    resolveByTable(holder.targetTable)?.cascade,
    original,
  )
  children.forEach(({ table, rows }, i) => {
    const key = cascadeKeys[i]
    // A payload predating a cascade table stays without it.
    if (!Object.hasOwn(original, key)) return
    payload[key] = rows.flatMap((row) => {
      const copy = byRow.get(heldKey(table, row.id as string))
      if (copy === undefined) return [row]
      return copy.removed ? [] : [copy.row]
    })
  })
  return payload
}

// One payload write per changed delete; a delete whose own row is removed is pruned instead,
// taking any strip or patch on it along.
function settleHeldCopies(
  copies: ReadonlyMap<string, HeldCopy>,
  ctx: DbCtx,
): { payloadOps: SqlOp[]; pruned: Delta[]; rewritten: Map<string, Record<string, unknown>> } {
  const byHolder = new Map<string, HeldCopy[]>()
  for (const copy of copies.values()) {
    const group = byHolder.get(copy.held.holder.id)
    if (group) group.push(copy)
    else byHolder.set(copy.held.holder.id, [copy])
  }
  const payloadOps: SqlOp[] = []
  const pruned: Delta[] = []
  const rewritten = new Map<string, Record<string, unknown>>()
  for (const group of byHolder.values()) {
    const { holder } = group[0].held
    if (group.some((c) => c.held.place === 'target' && c.removed)) {
      pruned.push(holder)
      continue
    }
    const payload = rebuiltPayload(holder, group)
    rewritten.set(holder.id, payload)
    payloadOps.push(
      ctx.db.update(deltas).set({ undoPayload: payload }).where(eq(deltas.id, holder.id)).toSQL(),
    )
  }
  return { payloadOps, pruned, rewritten }
}

// A write left naming a gone row would CTRL-Z to nothing. Redo restores none of them, so CTRL-Z and
// redo refuse rather than prune (generation-pipeline.md → Reverse-replay).
async function strandedWritesOf(
  ctx: DbCtx,
  set: ReversalSet,
  endsAbsent: ReadonlyMap<string, RowRef>,
  heldCopies: ReadonlyMap<string, HeldCopy>,
): Promise<Delta[]> {
  const removedRows = [
    ...endsAbsent.values(),
    ...[...heldCopies.values()]
      .filter((c) => c.removed && resolveByTable(c.held.table)?.rowKeepingColumns)
      .map((c) => ({ table: c.held.table, id: c.held.id })),
  ]
  if (removedRows.length === 0) return []
  const inSet = new Set(set.rows.map((d) => d.id))
  return (await writesTo(ctx, set.branchId, removedRows)).filter((d) => !inSet.has(d.id))
}

function namesId(value: unknown, id: string): boolean {
  if (value === id) return true
  if (Array.isArray(value)) return value.some((item) => namesId(item, id))
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).some((item) => namesId(item, id))
  )
}

// generation-pipeline.md → Reverse-replay: a later CTRL-Z of the pruned delete's group would
// restore a dead id. A group-mate this plan rewrites is read as rewritten.
async function refuseWriteBack(
  ctx: DbCtx,
  set: ReversalSet,
  pruned: readonly Delta[],
  rewritten: ReadonlyMap<string, Record<string, unknown>>,
  stranded: readonly Delta[],
): Promise<void> {
  if (pruned.length === 0) return
  const settled = new Set([...set.rows, ...pruned, ...stranded].map((d) => d.id))
  const actionIds = [...new Set(pruned.map((d) => d.actionId))]
  for (let i = 0; i < actionIds.length; i += BIND_CHUNK) {
    const group = (await ctx.db
      .select()
      .from(deltas)
      .where(
        and(
          eq(deltas.branchId, set.branchId),
          inArray(deltas.actionId, actionIds.slice(i, i + BIND_CHUNK)),
        ),
      )) as Delta[]
    for (const holder of pruned) {
      const hit = group.find(
        (d) =>
          d.actionId === holder.actionId &&
          !settled.has(d.id) &&
          namesId(rewritten.get(d.id) ?? d.undoPayload, holder.targetId),
      )
      if (hit)
        throw new ReversalIntegrityError(
          'write-back',
          `${holder.targetTable}:${holder.targetId} is named by delta ${hit.id}`,
          set.rows[0]?.actionId ?? 'reversal',
        )
    }
  }
}

// Per-row working copy: same-row undos (even disjoint JSON sub-keys) compose, not clobber via a
// stale base. Machine undos yield to later user edits: generation-pipeline.md → Reverse-replay.
async function buildUndoOps(
  set: ReversalSet,
  ctx: DbCtx,
  options: ReversalOptions,
): Promise<BuiltUndo> {
  const rows = set.rows
  const working = new Map<string, Record<string, unknown>>()
  // A tombstone keeps the deleted row so an older undo giving back a row-keeping column
  // re-inserts it; a row already missing, or deleted by a create's undo here, stays out.
  const tombstones = new Set<string>()
  const absent = new Set<string>()
  const ops: SqlOp[] = []
  const patches: PatchEmission[] = []
  // A kept create's row exists only through the user writes that kept it, so the create goes to
  // the oldest of them, the last a newest-first CTRL-Z reaches; pruned, the row's next reversal
  // by reference would find no create and refuse.
  const reowned = new Map<string, string>()
  const listVecTables = vecTableLister(ctx)
  const laterUserEdits = await userEditsOutliving(ctx, rows, readsUserEdits)
  const liveLinks = await liveLinkFilter(rows, ctx)
  // Vectors carry no deltas, so the closure can't reach them (retrieval.md → Compute lifecycle).
  const swept = new Map<string, { table: string; branchId: string; ids: string[] }>()
  const inSet = new Set(rows.map((r) => r.id))
  // A row a delete outside the set holds takes its undo on that delete's payload copy; a
  // holder inside the set is newer, so its undo has already put the row back.
  const heldCopies = new Map<string, HeldCopy>()
  // Row-keeping rows this plan deletes, keyed like `working`; a later re-insert takes one back out.
  const endsAbsent = new Map<string, RowRef>()

  for (const delta of rows) {
    const entry = resolveByTable(delta.targetTable)
    if (!entry) throw new Error(`reverse-replay: unknown target_table ${delta.targetTable}`)
    const { table } = entry.descriptor
    const where = whereForDelta(entry.descriptor, delta)
    const key = `${delta.targetTable}:${delta.branchId}:${delta.targetId}`
    const userEdits = laterUserEdits.get(delta.id) ?? []

    const workingRow = async (): Promise<Record<string, unknown>> => {
      let row = working.get(key)
      if (!row) {
        const [current] = (await ctx.db.select().from(table).where(where)) as Record<
          string,
          unknown
        >[]
        if (!current) absent.add(key)
        row = { ...(current ?? {}) }
        working.set(key, row)
      }
      return row
    }

    const heldCopy = async (): Promise<HeldCopy | undefined> => {
      const heldId = heldKey(delta.targetTable, delta.targetId)
      const known = heldCopies.get(heldId)
      if (known) return known
      const held = set.held.byRow.get(heldId)
      if (!held || inSet.has(held.holder.id)) return undefined
      await workingRow()
      if (!absent.has(key)) return undefined
      const copy: HeldCopy = { held, row: { ...held.row }, removed: false }
      heldCopies.set(heldId, copy)
      return copy
    }

    const emitUpdate = (restored: Record<string, unknown>, row: Record<string, unknown>) => {
      // Revalidation (app-deps.ts) only clears this flag — setting it dirty here self-corrects.
      if (undoDirtiesVector(delta.targetTable, Object.keys(restored))) {
        restored.embeddingStale = 1
        row.embeddingStale = 1
      }
      ops.push(ctx.db.update(table).set(restored).where(where).toSQL())
      patches.push({
        table: delta.targetTable,
        branchId: delta.branchId,
        patch: { op: 'update', id: delta.targetId, columns: restored },
      })
    }

    const emitDelete = () => {
      ops.push(ctx.db.delete(table).where(where).toSQL())
      patches.push({
        table: delta.targetTable,
        branchId: delta.branchId,
        patch: { op: 'delete', id: delta.targetId },
      })
    }

    const emitInsert = (row: Record<string, unknown>) => {
      if (isEmbeddedSourceTable(delta.targetTable)) row.embeddingStale = 1
      ops.push(ctx.db.insert(table).values(row).toSQL())
      patches.push({
        table: delta.targetTable,
        branchId: delta.branchId,
        patch: { op: 'create', id: delta.targetId, row: { ...row } },
      })
    }

    // No child-row cascade: a child goes only through its own create, which the closure
    // (row-closure.ts) puts in the set.
    if (delta.op === 'create') {
      const keeping = entry.rowKeepingColumns ?? []
      const userKept = keeping.filter((col) => wroteColumn(userEdits, col))
      const copy = await heldCopy()
      if (copy) {
        // The live arm's row-keeping exemption, on the payload copy.
        copy.removed = !userKept.some((col) => copy.row[col] != null)
        if (!copy.removed) {
          for (const col of keeping) if (!userKept.includes(col)) copy.row[col] = null
          reowned.set(delta.id, oldestKeepingWrite(userEdits, userKept).actionId)
        }
        continue
      }
      if (userKept.length > 0) {
        const row = await workingRow()
        const restored: Record<string, unknown> = {}
        for (const col of keeping) {
          if (!userKept.includes(col) && row[col] != null) restored[col] = null
        }
        if (userKept.some((col) => row[col] != null)) {
          Object.assign(row, restored)
          if (Object.keys(restored).length > 0) emitUpdate(restored, row)
          reowned.set(delta.id, oldestKeepingWrite(userEdits, userKept).actionId)
          continue
        }
      }
      working.set(key, {})
      absent.add(key)
      tombstones.delete(key)
      if (entry.rowKeepingColumns)
        endsAbsent.set(key, { table: delta.targetTable, id: delta.targetId })
      emitDelete()
      if (isEmbeddedSourceTable(delta.targetTable)) {
        const sweepKey = `${delta.targetTable}:${delta.branchId}`
        const sweep = swept.get(sweepKey) ?? {
          table: delta.targetTable,
          branchId: delta.branchId,
          ids: [],
        }
        sweep.ids.push(delta.targetId)
        swept.set(sweepKey, sweep)
      }
      continue
    }
    if (delta.op === 'delete') {
      const full = (delta.undoPayload ?? {}) as Record<string, unknown>
      const { children: captured, cascadeKeys } = capturedChildren(entry.cascade, full)
      const children = liveLinks(delta.branchId, captured)

      const rowData = { ...full }
      for (const payloadKey of Object.keys(rowData)) {
        if (cascadeKeys.includes(payloadKey) || isPayloadMetaKey(payloadKey))
          delete rowData[payloadKey]
      }
      // The payload's flag was accurate at delete time, but an embedder swap since
      // then re-embeds only LIVE rows, so the vector can be gone while it reads clean.
      if (isEmbeddedSourceTable(delta.targetTable)) rowData.embeddingStale = 1

      working.set(key, { ...rowData })
      absent.delete(key)
      tombstones.delete(key)
      endsAbsent.delete(key)
      ops.push(ctx.db.insert(table).values(rowData).toSQL())
      patches.push({
        table: delta.targetTable,
        branchId: delta.branchId,
        patch: { op: 'create', id: delta.targetId, row: rowData },
      })

      for (const { table: childTableName, rows: childRows } of children) {
        // drizzle's values() throws on an empty array, so an empty child set must
        // never reach it — a domain declaring one is saying "nothing to restore".
        if (childRows.length === 0) continue
        const childEntry = resolveByTable(childTableName)
        if (!childEntry) throw new Error(`reverse-replay: unknown child table ${childTableName}`)
        const { table: childTable } = childEntry.descriptor
        const childIsEmbedded = isEmbeddedSourceTable(childTableName)
        const restoredChildren: Record<string, unknown>[] = childIsEmbedded
          ? childRows.map((childRow) => ({ ...childRow, embeddingStale: 1 }))
          : childRows
        // A wide child table × large row count can overrun SQLite's per-statement bind cap —
        // chunk by the table's full column count, an upper bound on drizzle's binds per row.
        const chunkSize = rowsPerInsert(Object.keys(getTableColumns(childTable)).length)
        for (let i = 0; i < restoredChildren.length; i += chunkSize) {
          ops.push(
            ctx.db
              .insert(childTable)
              .values(restoredChildren.slice(i, i + chunkSize))
              .toSQL(),
          )
        }
        for (const childRow of restoredChildren) {
          // Seeded so an older undo on the child composes onto the restored row.
          const childKey = `${childTableName}:${delta.branchId}:${childRow.id as string}`
          working.set(childKey, { ...childRow })
          absent.delete(childKey)
          tombstones.delete(childKey)
          endsAbsent.delete(childKey)
          patches.push({
            table: childTableName,
            branchId: delta.branchId,
            patch: { op: 'create', id: childRow.id as string, row: childRow },
          })
        }
      }
      continue
    }

    const payload = (delta.undoPayload ?? {}) as Record<string, unknown>
    // A schema-backed column's undo restores sub-fields — a user write to one doesn't cover
    // the others this delta changed.
    const columns = Object.keys(payload).filter(
      (col) =>
        !isPayloadMetaKey(col) &&
        (Object.hasOwn(entry.columnSchemas, col) || !wroteColumn(userEdits, col)),
    )
    if (columns.length === 0) continue
    const copy = await heldCopy()
    if (copy) {
      for (const col of columns)
        copy.row[col] = undoneValue(entry.columnSchemas[col], payload[col], copy.row[col])
      const keeping = entry.rowKeepingColumns
      copy.removed = keeping !== undefined && keeping.every((col) => copy.row[col] == null)
      continue
    }
    const row = await workingRow()
    const restored: Record<string, unknown> = {}
    for (const col of columns) {
      const value = undoneValue(entry.columnSchemas[col], payload[col], row[col])
      restored[col] = value
      row[col] = value // thread into the working copy for later-in-DESC undos
    }
    const keeping = entry.rowKeepingColumns
    const keepsNone = keeping !== undefined && keeping.every((col) => row[col] == null)
    if (tombstones.has(key)) {
      if (!keepsNone) {
        tombstones.delete(key)
        endsAbsent.delete(key)
        emitInsert(row)
      }
    } else if (keepsNone && !absent.has(key)) {
      tombstones.add(key)
      endsAbsent.set(key, { table: delta.targetTable, id: delta.targetId })
      emitDelete()
    } else emitUpdate(restored, row)
  }

  // Stores hold no deleted rows, so a payload edit emits no patch.
  const { payloadOps, pruned, rewritten } = settleHeldCopies(heldCopies, ctx)
  const strandedWrites = await strandedWritesOf(ctx, set, endsAbsent, heldCopies)
  const [stranded] = strandedWrites
  if (options.keepRedoExact && stranded)
    throw new ReversalIntegrityError(
      'pruned-outside-redo',
      `${stranded.targetTable}:${stranded.targetId} ends absent; pruning ${stranded.id} would leave redo inexact`,
      set.rows[0]?.actionId ?? 'reversal',
    )
  await refuseWriteBack(ctx, set, pruned, rewritten, strandedWrites)
  ops.push(...payloadOps)

  // One vec0 scan per family table, not per row: each statement scans the whole table.
  for (const { table, branchId, ids } of swept.values())
    ops.push(...(await vecSweepIdsOps(table, branchId, ids, listVecTables)))

  return { ops, patches, reowned, prunedHolders: pruned, strandedWrites }
}

function oldestKeepingWrite(edits: readonly Delta[], columns: readonly string[]): Delta {
  const keeping = edits.filter((e) => columns.some((col) => wroteColumn([e], col)))
  return keeping.reduce((oldest, e) => (e.logPosition < oldest.logPosition ? e : oldest))
}

// A delete's undo re-inserts the whole row whatever came after, so it reads no user edits.
function readsUserEdits(delta: Delta): boolean {
  if (delta.op === 'update') return true
  return delta.op === 'create' && resolveByTable(delta.targetTable)?.rowKeepingColumns != null
}

export async function reverseAndPruneDeltaRows(
  set: ReversalSet,
  ctx: DbCtx,
  options: ReversalOptions,
  extraOps: readonly SqlOp[] = [],
): Promise<number> {
  if (set.rows.length === 0 && extraOps.length === 0) return 0
  const actionId = set.rows[0]?.actionId ?? 'rollback'
  return withKeyLocks(reversalLockKeys(set), async () => {
    let patches: PatchEmission[]
    try {
      const plan = await buildReverseAndPrunePlan(set, ctx, options)
      patches = plan.patches
      await ctx.runInTransaction([...plan.ops, ...plan.pruneOps, ...extraOps])
    } catch (e) {
      if (e instanceof ReversalIntegrityError) throw e
      throw new DeltaReplayError('Reverse-and-prune failed', {
        cause: e,
        actionId,
        stage: 'transaction',
      })
    }
    emitCommittedPatches(patches, actionId)
    return set.rows.length
  })
}

/**
 * Reverses and prunes in one transaction, as CTRL-Z does: rows left in the log would read as
 * the undo head and a later rollback's to-do (data-model.md → Entry mutability & rollback).
 * The action's deltas are closed through `selectReversalSet` first. Ops from
 * `settleOps(deltaCount)` join that transaction, even when `deltaCount` is 0.
 */
export async function reverseReplayDeltas(
  actionId: string,
  ctx: DbCtx,
  settleOps: (deltaCount: number) => readonly SqlOp[] = () => [],
): Promise<number> {
  // A refusal already names what it refused and committed nothing; wrapping would hide it.
  const fail = (e: unknown): DeltaReplayError =>
    e instanceof ReversalIntegrityError
      ? e
      : new DeltaReplayError('Reverse-replay failed', { cause: e, actionId, stage: 'transaction' })
  let set: ReversalSet
  try {
    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, actionId))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    // An empty seed runs no query, so its branch is never read.
    set = await selectReversalSet(ctx, { branchId: rows[0]?.branchId ?? '', target: rows })
  } catch (e) {
    throw fail(e)
  }
  return withKeyLocks(reversalLockKeys(set), async () => {
    let patches: PatchEmission[]
    try {
      const settle = settleOps(set.rows.length)
      if (set.rows.length === 0 && settle.length === 0) return 0

      const plan = await buildReverseAndPrunePlan(set, ctx, { keepRedoExact: false })
      patches = plan.patches
      await ctx.runInTransaction([...plan.ops, ...plan.pruneOps, ...settle])
    } catch (e) {
      throw fail(e)
    }
    // Action layer owns the patch: invert in the held-branch store after the tx.
    emitCommittedPatches(patches, actionId)
    return set.rows.length
  })
}
