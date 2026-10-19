import { and, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm'

import { chunked, deltas, type Delta } from '@/lib/db'

import { isUserOriginatedSource, type DbCtx } from '../types'
import { isPayloadMetaKey } from './delta-encoding'
import {
  EMPTY_HELD_ROWS,
  heldKey,
  loadHeldRows,
  type HeldKey,
  type HeldRowIndex,
} from './held-rows'
import {
  absentRefs,
  columnRefs,
  isPathRef,
  isRefTable,
  pathRefIds,
  pathRefsOf,
  referrersOf,
  type LiveRef,
  type RefColumn,
  type RefPath,
} from './live-refs'
import { resolveByTable } from './registry'
import { ReversalIntegrityError } from './replay-errors'
import { deltaLockKeys, type RowLockKey } from './row-locks'
import { userEditsOutliving, wroteColumn, wrotePath } from './user-precedence'

type ReversalSetFields = Pick<ReversalSet, 'branchId' | 'rows' | 'redoRows' | 'held' | 'refClears'>

/**
 * A JSON-path ref of a row the reversal keeps that, once the set's undos run, names a row the
 * reversal removes, or one already gone when the undos write that value.
 */
export type RefClear = {
  readonly row: RowRef
  readonly ref: RefPath
  /** The id of the removed or gone `ref.refTable` row it names. */
  readonly removedId: string
}

/** A closed reversal set, built only by selectReversalSet so no path reverses an unclosed one. */
class ReversalSet {
  // A private field makes the type nominal: no literal or spread of a set satisfies it.
  readonly #closed = true
  readonly branchId: string
  /** Every delta the reversal replays then prunes (or re-owns for a kept create), newest-first. */
  readonly rows: readonly Delta[]
  /** The target and what the closure reaches from it, newest-first: what CTRL-Z's redo restores. */
  readonly redoRows: readonly Delta[]
  /** The rows the branch's deletes held when the set was selected. */
  readonly held: HeldRowIndex
  /** The refs the planner nulls, in a live row or a held copy, writing no delta. */
  readonly refClears: readonly RefClear[]

  constructor(fields: ReversalSetFields) {
    this.branchId = fields.branchId
    this.rows = fields.rows
    this.redoRows = fields.redoRows
    this.held = fields.held
    this.refClears = fields.refClears
  }
}

// Type-only: a value export would let another module construct an unclosed set.
export type { ReversalSet }

export type ReversalSeed = {
  readonly branchId: string
  /** The action being undone, or a path's whole selection. */
  readonly target: readonly Delta[]
  /** Rows reversed because prose moved; redo leaves them and what only they reach to re-derive. */
  readonly sweep?: readonly Delta[]
}

export type RowRef = { readonly table: string; readonly id: string }

function idsByTable(rows: readonly RowRef[]): Map<string, string[]> {
  const byTable = new Map<string, string[]>()
  for (const { table, id } of rows) {
    const ids = byTable.get(table)
    if (ids) ids.push(id)
    else byTable.set(table, [id])
  }
  return byTable
}

/** Every create and update of the rows, whatever its source; a delete of one never joins. */
export async function writesTo(
  ctx: DbCtx,
  branchId: string,
  rows: readonly RowRef[],
): Promise<Delta[]> {
  const found: Delta[] = []
  for (const [targetTable, ids] of idsByTable(rows)) {
    for (const chunk of chunked(ids)) {
      const hits = (await ctx.db
        .select()
        .from(deltas)
        .where(
          and(
            eq(deltas.branchId, branchId),
            eq(deltas.targetTable, targetTable),
            inArray(deltas.targetId, chunk),
            ne(deltas.op, 'delete'),
          ),
        )) as Delta[]
      found.push(...hits)
    }
  }
  return found
}

type Referrer = RowRef & { readonly ref: RefColumn; readonly named: string }

/** Live rows on the branch naming any of `rows` through the REF_COLUMNS refs `picks` keeps. */
async function liveReferrers(
  ctx: DbCtx,
  branchId: string,
  rows: readonly RowRef[],
  picks: (ref: RefColumn) => boolean,
): Promise<Referrer[]> {
  const found: Referrer[] = []
  for (const [refTable, ids] of idsByTable(rows)) {
    if (!isRefTable(refTable)) continue
    for (const { table: name, ref } of referrersOf(refTable)) {
      if (!picks(ref)) continue
      // Boot registers every referring table; a test registering a subset skips the rest.
      const entry = resolveByTable(name)
      if (!entry) continue
      const { table, idCol, branchCol } = entry.descriptor
      const columns = getTableColumns(table)
      const column = columns[ref.column]
      const value =
        ref.path === undefined ? sql`${column}` : sql`json_extract(${column}, ${`$.${ref.path}`})`
      for (const chunk of chunked(ids)) {
        const hits = await ctx.db
          .select({ id: idCol, named: value })
          .from(table)
          .where(
            and(
              branchCol ? eq(branchCol, branchId) : undefined,
              inArray(value, chunk),
              ref.when ? eq(columns[ref.when.column], ref.when.value) : undefined,
            ),
          )
        for (const { id, named } of hits)
          if (typeof id === 'string' && typeof named === 'string')
            found.push({ table: name, id, ref, named })
      }
    }
  }
  return found
}

/**
 * A JSON-path ref's id once the set's undos have run, from the oldest set update that changed it
 * and no later user write overrode.
 */
type RestoredRef = {
  readonly row: RowRef
  readonly ref: RefPath
  readonly id: string | null
  readonly logPosition: number
}

const restoredKey = (row: RowRef, ref: RefPath) =>
  `${heldKey(row.table, row.id)}:${ref.column}.${ref.path}`

/** The JSON-path refs an update changed, each with the id it replaced. */
function pathUndos(d: Delta): { ref: RefPath; id: string | null }[] {
  if (d.op !== 'update') return []
  return pathRefsOf(d.targetTable).flatMap((ref) => {
    const column = d.undoPayload?.[ref.column]
    if (typeof column !== 'object' || column === null || !Object.hasOwn(column, ref.path)) return []
    const id = (column as Record<string, unknown>)[ref.path]
    return [{ ref, id: typeof id === 'string' ? id : null }]
  })
}

// The newest-first walk applies the oldest update's undo last, unless a later user write changed
// that field (generation-pipeline.md → Reverse-replay).
function restoredRefs(
  set: Iterable<Delta>,
  laterUserEdits: ReadonlyMap<string, readonly Delta[]>,
): Map<string, RestoredRef> {
  const restored = new Map<string, RestoredRef>()
  for (const d of set) {
    const edits = laterUserEdits.get(d.id) ?? []
    for (const { ref, id } of pathUndos(d)) {
      if (wrotePath(edits, ref.column, [ref.path])) continue
      const row = { table: d.targetTable, id: d.targetId }
      const key = restoredKey(row, ref)
      const seen = restored.get(key)
      if (!seen || d.logPosition < seen.logPosition)
        restored.set(key, { row, ref, id, logPosition: d.logPosition })
    }
  }
  return restored
}

/**
 * Seeded rows a later outside `user_edit` kept by writing a keeping column, each with the keeping
 * columns no such write set, which the planner nulls. Judged from `writes`: a separate read lets a
 * user Save landing between the two join the set and be reversed.
 */
function userKeptRows(
  seedCreates: ReadonlyMap<HeldKey, readonly Delta[]>,
  writes: readonly Delta[],
  seedIds: ReadonlySet<string>,
): Map<HeldKey, readonly string[]> {
  const userWrites = new Map<HeldKey, Delta[]>()
  for (const d of writes) {
    if (d.source !== 'user_edit' || seedIds.has(d.id)) continue
    const key = heldKey(d.targetTable, d.targetId)
    const found = userWrites.get(key)
    if (found) found.push(d)
    else userWrites.set(key, [d])
  }
  const kept = new Map<HeldKey, readonly string[]>()
  for (const [key, creates] of seedCreates) {
    const edits = userWrites.get(key) ?? []
    const keeping = resolveByTable(creates[0].targetTable)?.rowKeepingColumns ?? []
    const keptAll = creates.every((create) => {
      if (isUserOriginatedSource(create.source)) return false
      const later = edits.filter((e) => e.logPosition > create.logPosition)
      return keeping.some((col) => wroteColumn(later, col))
    })
    if (!keptAll) continue
    const first = Math.min(...creates.map((c) => c.logPosition))
    const later = edits.filter((e) => e.logPosition > first)
    kept.set(
      key,
      keeping.filter((col) => !wroteColumn(later, col)),
    )
  }
  return kept
}

// A machine update that wrote only views a kept row's create had its view nulled in: it built on
// the swept fact, so it goes with it, as a removed row's later writes do. Left in the log, its
// undo would write the swept value back.
function onlyNulledViews(delta: Delta, nulled: readonly string[]): boolean {
  if (delta.op !== 'update' || isUserOriginatedSource(delta.source)) return false
  const columns = Object.keys(delta.undoPayload ?? {}).filter((key) => !isPayloadMetaKey(key))
  return columns.length > 0 && columns.every((col) => nulled.includes(col))
}

type Closure = {
  /** Newest-first. */
  readonly rows: readonly Delta[]
  readonly removed: ReadonlyMap<HeldKey, RowRef>
}

const NOTHING_CLOSED: Closure = { rows: [], removed: new Map() }

// Fixed point of generation-pipeline.md → Reverse-replay: removed rows, then every row naming one.
async function closeOver(
  ctx: DbCtx,
  branchId: string,
  seed: readonly Delta[],
  held: HeldRowIndex,
  actionId: string,
): Promise<Closure> {
  const set = new Map(seed.map((d) => [d.id, d]))
  const removed = new Map<HeldKey, RowRef>()
  const byReference = new Set<HeldKey>()
  let frontier: RowRef[] = []
  const remove = (row: RowRef, viaReference: boolean) => {
    const key = heldKey(row.table, row.id)
    if (removed.has(key)) return
    const ref = { table: row.table, id: row.id }
    removed.set(key, ref)
    if (viaReference) byReference.add(key)
    frontier.push(ref)
  }
  const isRemoved = (ref: LiveRef) => removed.has(heldKey(ref.table, ref.id))

  const seedIds = new Set(seed.map((d) => d.id))
  let seedCreates = new Map<HeldKey, Delta[]>()
  for (const d of seed) {
    if (d.op !== 'create') continue
    const key = heldKey(d.targetTable, d.targetId)
    const creates = seedCreates.get(key)
    if (creates) creates.push(d)
    else seedCreates.set(key, [d])
    remove({ table: d.targetTable, id: d.targetId }, false)
  }

  while (frontier.length > 0) {
    let round = frontier
    frontier = []
    let writes = await writesTo(ctx, branchId, round)
    // Only the seed's own creates can be kept; a row reached by reference later goes regardless.
    const kept = userKeptRows(seedCreates, writes, seedIds)
    seedCreates = new Map()
    if (kept.size > 0) {
      for (const key of kept.keys()) removed.delete(key)
      round = round.filter(({ table, id }) => !kept.has(heldKey(table, id)))
      writes = writes.filter((d) => {
        const nulled = kept.get(heldKey(d.targetTable, d.targetId))
        return nulled === undefined || onlyNulledViews(d, nulled)
      })
    }
    for (const d of writes) if (!set.has(d.id)) set.set(d.id, d)
    const created = new Set(
      writes.filter((d) => d.op === 'create').map((d) => heldKey(d.targetTable, d.targetId)),
    )
    for (const { table, id } of round) {
      const key = heldKey(table, id)
      if (byReference.has(key) && !created.has(key))
        throw new ReversalIntegrityError('no-create', key, actionId)
    }
    // A JSON-path ref takes nothing: the planner clears it (refClearsOf).
    for (const hit of await liveReferrers(ctx, branchId, round, (ref) => !isPathRef(ref)))
      remove(hit, true)
    for (const { table, id } of round) {
      if (!isRefTable(table)) continue
      for (const named of held.naming(table, id))
        if (columnRefs(named.table, named.row).some(isRemoved)) remove(named, true)
    }
  }
  return { rows: [...set.values()].sort((a, b) => b.logPosition - a.logPosition), removed }
}

type PathRefValue = { readonly row: RowRef; readonly ref: RefPath; readonly id: string | null }

// generation-pipeline.md → Reverse-replay: a written ref never names a missing row, so a row
// deleted outside the set counts as removed; a row a delete in the set puts back counts present.
async function goneRows(
  ctx: DbCtx,
  branchId: string,
  written: readonly PathRefValue[],
  rows: readonly Delta[],
  removed: ReadonlyMap<HeldKey, RowRef>,
): Promise<ReadonlySet<HeldKey>> {
  const reinserted = new Set(
    rows.filter((d) => d.op === 'delete').map((d) => heldKey(d.targetTable, d.targetId)),
  )
  const candidates = written.flatMap(({ ref, id }) => {
    if (id === null) return []
    const key = heldKey(ref.refTable, id)
    return removed.has(key) || reinserted.has(key) ? [] : [{ table: ref.refTable, id }]
  })
  const absent = await absentRefs(ctx, branchId, candidates)
  return new Set(absent.map(({ table, id }) => heldKey(table, id)))
}

// Entities go only through their own create, so the fixed point never waits on a clear.
async function refClearsOf(
  ctx: DbCtx,
  branchId: string,
  { rows, removed }: Closure,
  held: HeldRowIndex,
): Promise<RefClear[]> {
  const laterUserEdits = await userEditsOutliving(ctx, rows, (d) => pathUndos(d).length > 0)
  const restored = restoredRefs(rows, laterUserEdits)
  const unmoved = (row: RowRef, ref: RefPath) => !restored.has(restoredKey(row, ref))
  // What the set's undos write: each moved ref's restored value, and each re-inserted row's refs.
  const written: PathRefValue[] = [
    ...restored.values(),
    ...rows
      .filter((d) => d.op === 'delete')
      .flatMap((d) => {
        const row = { table: d.targetTable, id: d.targetId }
        return pathRefIds(d.targetTable, d.undoPayload ?? {})
          .filter(({ ref }) => unmoved(row, ref))
          .map(({ ref, id }) => ({ row, ref, id }))
      }),
  ]
  const gone = await goneRows(ctx, branchId, written, rows, removed)
  const clears = new Map<string, RefClear>()
  const judge = (row: RowRef, ref: RefPath, id: string | null) => {
    if (id === null || removed.has(heldKey(row.table, row.id))) return
    const named = heldKey(ref.refTable, id)
    if (removed.has(named) || gone.has(named))
      clears.set(restoredKey(row, ref), {
        row: { table: row.table, id: row.id },
        ref,
        removedId: id,
      })
  }
  // A row the set moved is judged by where its undos leave it, the rest by the value they hold.
  for (const { row, ref, id } of written) judge(row, ref, id)
  const named = [...removed.values()].filter((row): row is LiveRef => isRefTable(row.table))
  for (const hit of await liveReferrers(ctx, branchId, named, isPathRef))
    if (isPathRef(hit.ref) && unmoved(hit, hit.ref)) judge(hit, hit.ref, hit.named)
  for (const { table, id } of named) {
    for (const copy of held.naming(table, id))
      for (const { ref, id: names } of pathRefIds(copy.table, copy.row))
        if (unmoved(copy, ref)) judge(copy, ref, names)
  }
  return [...clears.values()]
}

export async function selectReversalSet(ctx: DbCtx, seed: ReversalSeed): Promise<ReversalSet> {
  const { branchId, target } = seed
  const sweep = seed.sweep ?? []
  const all = [...target, ...sweep]
  const stray = all.find((d) => d.branchId !== branchId)
  if (stray)
    throw new Error(
      `selectReversalSet: delta ${stray.id} is on ${stray.branchId}, not the seed branch ${branchId}`,
    )
  if (all.length === 0)
    return new ReversalSet({
      branchId,
      rows: [],
      redoRows: [],
      held: EMPTY_HELD_ROWS,
      refClears: [],
    })

  const held = await loadHeldRows(ctx, branchId)
  const { actionId } = all[0]
  const redo =
    target.length > 0 ? await closeOver(ctx, branchId, target, held, actionId) : NOTHING_CLOSED
  const closure =
    sweep.length > 0
      ? await closeOver(ctx, branchId, [...redo.rows, ...sweep], held, actionId)
      : redo
  const refClears = await refClearsOf(ctx, branchId, closure, held)
  return new ReversalSet({ branchId, rows: closure.rows, redoRows: redo.rows, held, refClears })
}

/** Row keys for the rows the set writes or clears a ref in, and for every delete holding one. */
export function reversalLockKeys(set: ReversalSet): RowLockKey[] {
  const written = [
    ...set.rows,
    ...set.refClears.map(({ row }) => ({
      branchId: set.branchId,
      targetTable: row.table,
      targetId: row.id,
    })),
  ]
  const holders = written.flatMap((d) => {
    const held = set.held.byRow.get(heldKey(d.targetTable, d.targetId))
    return held ? [held.holder] : []
  })
  return deltaLockKeys([...written, ...holders])
}
