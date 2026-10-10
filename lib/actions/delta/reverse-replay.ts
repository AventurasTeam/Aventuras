import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm'
import type { ZodType } from 'zod'

import type { Delta, SqlOp } from '@/lib/db'
import {
  chunked,
  deltas,
  embeddedFieldsForTable,
  isEmbeddedSourceTable,
  rowsPerInsert,
} from '@/lib/db'

import type { DbCtx } from '../types'
import { capturedChildren, vecSweepIdsOps, vecTableLister } from './delete-cascade'
import { applyUndoPayload, isPayloadMetaKey } from './delta-encoding'
import { deletedRow, heldKey, type HeldRow } from './held-rows'
import { withKeyLocks } from './key-lock'
import { liveLinkFilter, type LiveLinkFilter } from './live-link-filter'
import { resolveByTable, whereForDelta, type StorePatch, type TableEntry } from './registry'
import { DeltaReplayError, ReversalIntegrityError, type IntegrityRefusal } from './replay-errors'
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
): { detail: string; committed: boolean; refusal: IntegrityRefusal | null } | undefined {
  if (!(e instanceof DeltaReplayError)) return undefined
  const refusal = e instanceof ReversalIntegrityError ? e.refusal : null
  return { detail: String(e.cause), committed: e.committed, refusal }
}

export type PatchEmission = { table: string; branchId: string; patch: StorePatch }

/** Required, so a reversal that must keep redo exact cannot get the prune by omission. */
export type ReversalOptions = {
  /**
   * CTRL-Z and redo: refuse a reversal that would prune a row-keeping row's writes left outside
   * the set, which redo cannot restore.
   */
  keepRedoExact: boolean
}

export type ReversePlan = {
  /**
   * The undos' row writes, one `undo_payload` write per held delete they change, and the vector
   * sweeps of the rows they delete.
   */
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
 * The reversal of a closed set, unexecuted, for a caller committing it inside its own transaction.
 * Ops and prunes stay separate: their order against the caller's ops is the caller's call. The
 * prunes leave gaps in log_position (data-model.md → Entry mutability & rollback).
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
  /** Removed by its create's undo, so an older undo in the set cannot bring it back. */
  removedByCreate: boolean
}

/**
 * A row as the newest-first walk has left it. `missing`: absent when first read. `deleted`: a
 * create's undo here removed it. `tombstoned`: an undo here left it keeping nothing, so it is
 * deleted but its row kept, for an older undo giving back a row-keeping column to re-insert.
 */
type RowState = {
  readonly ref: RowRef
  /** Same-row undos (even disjoint JSON sub-keys) compose on this copy, not via a stale base. */
  row: Record<string, unknown>
  presence: 'live' | 'missing' | 'deleted' | 'tombstoned'
}

// A tombstone isn't absent: an older undo in the walk may still re-insert it.
function isAbsent(state: RowState): boolean {
  return state.presence === 'missing' || state.presence === 'deleted'
}

// A row-keeping row this reversal deletes; a later re-insert in the walk takes it back.
function endsAbsent(state: RowState): boolean {
  return (
    (state.presence === 'deleted' || state.presence === 'tombstoned') &&
    resolveByTable(state.ref.table)?.rowKeepingColumns !== undefined
  )
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

// A delete whose own row is removed is pruned, not rewritten; any strip or patch on it goes too.
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

// A write left targeting a gone row would CTRL-Z to nothing. Redo restores none of them, so CTRL-Z
// and redo refuse rather than prune (generation-pipeline.md → Reverse-replay).
async function strandedWritesOf(
  ctx: DbCtx,
  set: ReversalSet,
  rowStates: ReadonlyMap<string, RowState>,
  heldCopies: ReadonlyMap<string, HeldCopy>,
): Promise<Delta[]> {
  const removedRows = [
    ...[...rowStates.values()].filter(endsAbsent).map((state) => state.ref),
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

// edge-cases.md → Schema: an entity's collision partner is a plain id outside the reference
// registry, so a gone partner is dormant, never a reason to refuse.
function referencingPayload(d: Delta, rewritten: ReadonlyMap<string, Record<string, unknown>>) {
  const payload = rewritten.get(d.id) ?? d.undoPayload
  if (d.targetTable !== 'entities' || payload == null) return payload
  const { nameCollisionPartnerId: _partner, ...rest } = payload
  return rest
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
  for (const chunk of chunked(actionIds)) {
    const group = (await ctx.db
      .select()
      .from(deltas)
      .where(and(eq(deltas.branchId, set.branchId), inArray(deltas.actionId, chunk)))) as Delta[]
    for (const holder of pruned) {
      const hit = group.find(
        (d) =>
          d.actionId === holder.actionId &&
          !settled.has(d.id) &&
          namesId(referencingPayload(d, rewritten), holder.targetId),
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

function keepsNothing(entry: TableEntry, row: Record<string, unknown>): boolean {
  const keeping = entry.rowKeepingColumns
  return keeping !== undefined && keeping.every((col) => row[col] == null)
}

/** The reversal planned so far, which every undo arm reads and extends. */
type UndoWalk = {
  readonly ctx: DbCtx
  readonly set: ReversalSet
  readonly inSet: ReadonlySet<string>
  readonly rowStates: Map<string, RowState>
  // A row a delete outside the set holds takes its undo on that delete's payload copy; a
  // holder inside the set is newer, so its undo has already put the row back.
  readonly heldCopies: Map<string, HeldCopy>
  readonly ops: SqlOp[]
  readonly patches: PatchEmission[]
  // The create goes to the oldest user write that kept its row (the last a newest-first CTRL-Z
  // reaches); pruned, the row's next reversal by reference would find no create and refuse.
  readonly reowned: Map<string, string>
  // Vectors carry no deltas, so the closure can't reach them (retrieval.md → Compute lifecycle).
  readonly swept: Map<string, { table: string; branchId: string; ids: string[] }>
}

type UndoTarget = {
  readonly delta: Delta
  readonly entry: TableEntry
  readonly where: ReturnType<typeof whereForDelta>
  /** The key `UndoWalk.rowStates` holds the delta's row under. */
  readonly key: string
}

function rowKey(table: string, branchId: string, id: string): string {
  return `${table}:${branchId}:${id}`
}

function undoTargetOf(delta: Delta): UndoTarget {
  const entry = resolveByTable(delta.targetTable)
  if (!entry) throw new Error(`reverse-replay: unknown target_table ${delta.targetTable}`)
  return {
    delta,
    entry,
    where: whereForDelta(entry.descriptor, delta),
    key: rowKey(delta.targetTable, delta.branchId, delta.targetId),
  }
}

function refOf(delta: Delta): RowRef {
  return { table: delta.targetTable, id: delta.targetId }
}

async function rowStateOf(walk: UndoWalk, target: UndoTarget): Promise<RowState> {
  const known = walk.rowStates.get(target.key)
  if (known) return known
  const [current] = (await walk.ctx.db
    .select()
    .from(target.entry.descriptor.table)
    .where(target.where)) as Record<string, unknown>[]
  const state: RowState = {
    ref: refOf(target.delta),
    row: { ...(current ?? {}) },
    presence: current ? 'live' : 'missing',
  }
  walk.rowStates.set(target.key, state)
  return state
}

async function heldCopyOf(walk: UndoWalk, target: UndoTarget): Promise<HeldCopy | undefined> {
  const { delta } = target
  const heldId = heldKey(delta.targetTable, delta.targetId)
  const known = walk.heldCopies.get(heldId)
  if (known) return known
  const held = walk.set.held.byRow.get(heldId)
  if (!held || walk.inSet.has(held.holder.id)) return undefined
  if (!isAbsent(await rowStateOf(walk, target))) return undefined
  const copy: HeldCopy = { held, row: { ...held.row }, removed: false, removedByCreate: false }
  walk.heldCopies.set(heldId, copy)
  return copy
}

function emitUpdate(
  walk: UndoWalk,
  { delta, entry, where }: UndoTarget,
  restored: Record<string, unknown>,
  row: Record<string, unknown>,
): void {
  // Revalidation (app-deps.ts) only clears this flag — setting it dirty here self-corrects.
  if (undoDirtiesVector(delta.targetTable, Object.keys(restored))) {
    restored.embeddingStale = 1
    row.embeddingStale = 1
  }
  walk.ops.push(walk.ctx.db.update(entry.descriptor.table).set(restored).where(where).toSQL())
  walk.patches.push({
    table: delta.targetTable,
    branchId: delta.branchId,
    patch: { op: 'update', id: delta.targetId, columns: restored },
  })
}

function emitDelete(walk: UndoWalk, { delta, entry, where }: UndoTarget): void {
  walk.ops.push(walk.ctx.db.delete(entry.descriptor.table).where(where).toSQL())
  walk.patches.push({
    table: delta.targetTable,
    branchId: delta.branchId,
    patch: { op: 'delete', id: delta.targetId },
  })
}

function emitInsert(
  walk: UndoWalk,
  { delta, entry }: UndoTarget,
  row: Record<string, unknown>,
): void {
  // A deleted row's flag was accurate when it went, but an embedder swap since then re-embeds
  // only LIVE rows, so the vector can be gone while it reads clean.
  if (isEmbeddedSourceTable(delta.targetTable)) row.embeddingStale = 1
  walk.ops.push(walk.ctx.db.insert(entry.descriptor.table).values(row).toSQL())
  walk.patches.push({
    table: delta.targetTable,
    branchId: delta.branchId,
    patch: { op: 'create', id: delta.targetId, row: { ...row } },
  })
}

// No child-row cascade: a child goes only through its own create, which the closure
// (row-closure.ts) puts in the set.
async function undoCreate(
  walk: UndoWalk,
  target: UndoTarget,
  userEdits: readonly Delta[],
): Promise<void> {
  const { delta, entry } = target
  const copy = await heldCopyOf(walk, target)
  if (copy) {
    undoHeldCreate(walk, target, copy, userEdits)
    return
  }
  const keeping = entry.rowKeepingColumns ?? []
  const userKept = keeping.filter((col) => wroteColumn(userEdits, col))
  if (userKept.length > 0) {
    const { row } = await rowStateOf(walk, target)
    const restored: Record<string, unknown> = {}
    for (const col of keeping) {
      if (!userKept.includes(col) && row[col] != null) restored[col] = null
    }
    if (userKept.some((col) => row[col] != null)) {
      Object.assign(row, restored)
      if (Object.keys(restored).length > 0) emitUpdate(walk, target, restored, row)
      walk.reowned.set(delta.id, oldestKeepingWrite(userEdits, userKept).actionId)
      return
    }
  }
  walk.rowStates.set(target.key, { ref: refOf(delta), row: {}, presence: 'deleted' })
  emitDelete(walk, target)
  if (isEmbeddedSourceTable(delta.targetTable)) {
    const sweepKey = `${delta.targetTable}:${delta.branchId}`
    const sweep = walk.swept.get(sweepKey) ?? {
      table: delta.targetTable,
      branchId: delta.branchId,
      ids: [],
    }
    sweep.ids.push(delta.targetId)
    walk.swept.set(sweepKey, sweep)
  }
}

// The live arm's row-keeping exemption, on the payload copy.
function undoHeldCreate(
  walk: UndoWalk,
  { delta, entry }: UndoTarget,
  copy: HeldCopy,
  userEdits: readonly Delta[],
): void {
  const keeping = entry.rowKeepingColumns ?? []
  const userKept = keeping.filter((col) => wroteColumn(userEdits, col))
  copy.removed = !userKept.some((col) => copy.row[col] != null)
  copy.removedByCreate = copy.removed
  if (copy.removed) return
  for (const col of keeping) if (!userKept.includes(col)) copy.row[col] = null
  walk.reowned.set(delta.id, oldestKeepingWrite(userEdits, userKept).actionId)
}

function undoDelete(walk: UndoWalk, target: UndoTarget, liveLinks: LiveLinkFilter): void {
  const { delta, entry } = target
  const full = (delta.undoPayload ?? {}) as Record<string, unknown>
  const { children: captured, cascadeKeys } = capturedChildren(entry.cascade, full)
  const children = liveLinks(delta.branchId, captured)

  const rowData = deletedRow(full, cascadeKeys)
  emitInsert(walk, target, rowData)
  walk.rowStates.set(target.key, { ref: refOf(delta), row: { ...rowData }, presence: 'live' })

  for (const { table: childTableName, rows: childRows } of children) {
    // drizzle's values() throws on an empty array, so an empty child set must
    // never reach it — a domain declaring one is saying "nothing to restore".
    if (childRows.length === 0) continue
    const childEntry = resolveByTable(childTableName)
    if (!childEntry) throw new Error(`reverse-replay: unknown child table ${childTableName}`)
    const { table: childTable } = childEntry.descriptor
    const restoredChildren: Record<string, unknown>[] = isEmbeddedSourceTable(childTableName)
      ? childRows.map((childRow) => ({ ...childRow, embeddingStale: 1 }))
      : childRows
    // A wide child table × large row count can overrun SQLite's per-statement bind cap —
    // chunk by the table's full column count, an upper bound on drizzle's binds per row.
    const chunkSize = rowsPerInsert(Object.keys(getTableColumns(childTable)).length)
    for (let i = 0; i < restoredChildren.length; i += chunkSize) {
      walk.ops.push(
        walk.ctx.db
          .insert(childTable)
          .values(restoredChildren.slice(i, i + chunkSize))
          .toSQL(),
      )
    }
    for (const childRow of restoredChildren) {
      const id = childRow.id as string
      // Seeded so an older undo on the child composes onto the restored row.
      walk.rowStates.set(rowKey(childTableName, delta.branchId, id), {
        ref: { table: childTableName, id },
        row: { ...childRow },
        presence: 'live',
      })
      walk.patches.push({
        table: childTableName,
        branchId: delta.branchId,
        patch: { op: 'create', id, row: childRow },
      })
    }
  }
}

async function undoUpdate(
  walk: UndoWalk,
  target: UndoTarget,
  userEdits: readonly Delta[],
): Promise<void> {
  const { delta, entry } = target
  const payload = (delta.undoPayload ?? {}) as Record<string, unknown>
  // A schema-backed column's undo restores sub-fields — a user write to one doesn't cover
  // the others this delta changed.
  const columns = Object.keys(payload).filter(
    (col) =>
      !isPayloadMetaKey(col) &&
      (Object.hasOwn(entry.columnSchemas, col) || !wroteColumn(userEdits, col)),
  )
  if (columns.length === 0) return
  const copy = await heldCopyOf(walk, target)
  if (copy) {
    undoHeldUpdate(entry, copy, payload, columns)
    return
  }
  const state = await rowStateOf(walk, target)
  const { row } = state
  const restored: Record<string, unknown> = {}
  for (const col of columns) {
    const value = undoneValue(entry.columnSchemas[col], payload[col], row[col])
    restored[col] = value
    row[col] = value // thread into the working copy for later-in-DESC undos
  }
  const keepsNone = keepsNothing(entry, row)
  if (state.presence === 'tombstoned') {
    if (keepsNone) return
    state.presence = 'live'
    emitInsert(walk, target, row)
  } else if (keepsNone && !isAbsent(state)) {
    state.presence = 'tombstoned'
    emitDelete(walk, target)
  } else emitUpdate(walk, target, restored, row)
}

function undoHeldUpdate(
  entry: TableEntry,
  copy: HeldCopy,
  payload: Record<string, unknown>,
  columns: readonly string[],
): void {
  if (copy.removedByCreate) return
  for (const col of columns)
    copy.row[col] = undoneValue(entry.columnSchemas[col], payload[col], copy.row[col])
  copy.removed = keepsNothing(entry, copy.row)
}

// Machine undos yield to later user edits: generation-pipeline.md → Reverse-replay.
async function buildUndoOps(
  set: ReversalSet,
  ctx: DbCtx,
  options: ReversalOptions,
): Promise<BuiltUndo> {
  const walk: UndoWalk = {
    ctx,
    set,
    inSet: new Set(set.rows.map((r) => r.id)),
    rowStates: new Map(),
    heldCopies: new Map(),
    ops: [],
    patches: [],
    reowned: new Map(),
    swept: new Map(),
  }
  const listVecTables = vecTableLister(ctx)
  const laterUserEdits = await userEditsOutliving(ctx, set.rows, readsUserEdits)
  const liveLinks = await liveLinkFilter(set.rows, ctx)

  for (const delta of set.rows) {
    const target = undoTargetOf(delta)
    const userEdits = laterUserEdits.get(delta.id) ?? []
    if (delta.op === 'create') await undoCreate(walk, target, userEdits)
    else if (delta.op === 'delete') undoDelete(walk, target, liveLinks)
    else await undoUpdate(walk, target, userEdits)
  }

  // Stores hold no deleted rows, so a payload edit emits no patch.
  const { payloadOps, pruned, rewritten } = settleHeldCopies(walk.heldCopies, ctx)
  const strandedWrites = await strandedWritesOf(ctx, set, walk.rowStates, walk.heldCopies)
  const [stranded] = strandedWrites
  if (options.keepRedoExact && stranded)
    throw new ReversalIntegrityError(
      'pruned-outside-redo',
      `${stranded.targetTable}:${stranded.targetId} ends absent; pruning ${stranded.id} would leave redo inexact`,
      set.rows[0]?.actionId ?? 'reversal',
    )
  await refuseWriteBack(ctx, set, pruned, rewritten, strandedWrites)
  walk.ops.push(...payloadOps)

  // One vec0 scan per family table, not per row: each statement scans the whole table.
  for (const { table, branchId, ids } of walk.swept.values())
    walk.ops.push(...(await vecSweepIdsOps(table, branchId, ids, listVecTables)))

  return {
    ops: walk.ops,
    patches: walk.patches,
    reowned: walk.reowned,
    prunedHolders: pruned,
    strandedWrites,
  }
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
 * Reverses and prunes in one transaction, as CTRL-Z does: unpruned rows would read as the undo head
 * (data-model.md → Entry mutability & rollback). `settleOps(deltaCount)` ops join it, even at 0.
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
