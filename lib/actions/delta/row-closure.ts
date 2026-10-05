import { and, eq, getTableColumns, inArray, ne } from 'drizzle-orm'

import { BIND_CHUNK, deltas, type Delta } from '@/lib/db'

import { isUserOriginatedSource, type DbCtx } from '../types'
import {
  EMPTY_HELD_ROWS,
  heldKey,
  loadHeldRows,
  type HeldKey,
  type HeldRowIndex,
} from './held-rows'
import { isRefTable, referrersOf } from './live-refs'
import { resolveByTable } from './registry'
import { ReversalIntegrityError } from './replay-errors'
import { deltaLockKeys, type RowLockKey } from './row-locks'
import { firstLoggedAt, wroteColumn } from './user-precedence'

type ReversalSetFields = Pick<ReversalSet, 'branchId' | 'rows' | 'redoRows' | 'held'>

/** A closed reversal set; constructed only by selectReversalSet, so no path reverses an unclosed one. */
class ReversalSet {
  // A private field makes the type nominal: no literal or spread of a set satisfies it.
  readonly #closed = true
  readonly branchId: string
  /** Every delta the reversal replays, then prunes (or re-owns, for a kept create), newest-first. */
  readonly rows: readonly Delta[]
  /** The target and what the closure reaches from it, newest-first: what CTRL-Z's redo restores. */
  readonly redoRows: readonly Delta[]
  /** The rows the branch's deletes held when the set was selected. */
  readonly held: HeldRowIndex

  constructor(fields: ReversalSetFields) {
    this.branchId = fields.branchId
    this.rows = fields.rows
    this.redoRows = fields.redoRows
    this.held = fields.held
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

function chunked<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += BIND_CHUNK) chunks.push(items.slice(i, i + BIND_CHUNK))
  return chunks
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

/** Live rows on the branch naming any of `rows` through REF_COLUMNS. */
async function liveReferrers(
  ctx: DbCtx,
  branchId: string,
  rows: readonly RowRef[],
): Promise<RowRef[]> {
  const found: RowRef[] = []
  for (const [refTable, ids] of idsByTable(rows)) {
    if (!isRefTable(refTable)) continue
    for (const { table: name, ref } of referrersOf(refTable)) {
      // Boot registers every referring table; a test registering a subset skips the rest.
      const entry = resolveByTable(name)
      if (!entry) continue
      const { table, idCol, branchCol } = entry.descriptor
      const columns = getTableColumns(table)
      for (const chunk of chunked(ids)) {
        const hits = await ctx.db
          .select({ id: idCol })
          .from(table)
          .where(
            and(
              branchCol ? eq(branchCol, branchId) : undefined,
              inArray(columns[ref.column], chunk),
              ref.when ? eq(columns[ref.when.column], ref.when.value) : undefined,
            ),
          )
        for (const { id } of hits) if (typeof id === 'string') found.push({ table: name, id })
      }
    }
  }
  return found
}

/**
 * Seeded rows a later outside `user_edit` kept by writing a keeping column. Judged from `writes`:
 * a separate read lets a user Save landing between the two join the set and be reversed.
 */
function userKeptRows(
  seedCreates: ReadonlyMap<HeldKey, readonly Delta[]>,
  writes: readonly Delta[],
  seedIds: ReadonlySet<string>,
): Set<HeldKey> {
  const userWrites = new Map<HeldKey, Delta[]>()
  for (const d of writes) {
    if (d.source !== 'user_edit' || seedIds.has(d.id)) continue
    const key = heldKey(d.targetTable, d.targetId)
    const found = userWrites.get(key)
    if (found) found.push(d)
    else userWrites.set(key, [d])
  }
  const kept = new Set<HeldKey>()
  for (const [key, creates] of seedCreates) {
    const edits = userWrites.get(key) ?? []
    const keptAll = creates.every((create) => {
      if (isUserOriginatedSource(create.source)) return false
      const keeping = resolveByTable(create.targetTable)?.rowKeepingColumns
      const later = edits.filter((e) => firstLoggedAt(e) > firstLoggedAt(create))
      return keeping?.some((col) => wroteColumn(later, col)) ?? false
    })
    if (keptAll) kept.add(key)
  }
  return kept
}

// Fixed point of generation-pipeline.md → Reverse-replay: removed rows, then every row naming one.
async function closeOver(
  ctx: DbCtx,
  branchId: string,
  seed: readonly Delta[],
  held: HeldRowIndex,
  actionId: string,
): Promise<Delta[]> {
  const set = new Map(seed.map((d) => [d.id, d]))
  const removed = new Set<HeldKey>()
  const byReference = new Set<HeldKey>()
  let frontier: RowRef[] = []
  const remove = (row: RowRef, viaReference: boolean) => {
    const key = heldKey(row.table, row.id)
    if (removed.has(key)) return
    removed.add(key)
    if (viaReference) byReference.add(key)
    frontier.push({ table: row.table, id: row.id })
  }

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
      for (const key of kept) removed.delete(key)
      round = round.filter(({ table, id }) => !kept.has(heldKey(table, id)))
      writes = writes.filter((d) => !kept.has(heldKey(d.targetTable, d.targetId)))
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
    for (const row of await liveReferrers(ctx, branchId, round)) remove(row, true)
    for (const { table, id } of round) {
      if (!isRefTable(table)) continue
      for (const named of held.naming(table, id)) remove(named, true)
    }
  }
  return [...set.values()].sort((a, b) => b.logPosition - a.logPosition)
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
    return new ReversalSet({ branchId, rows: [], redoRows: [], held: EMPTY_HELD_ROWS })

  const held = await loadHeldRows(ctx, branchId)
  const { actionId } = all[0]
  const redoRows = target.length > 0 ? await closeOver(ctx, branchId, target, held, actionId) : []
  const rows =
    sweep.length > 0
      ? await closeOver(ctx, branchId, [...redoRows, ...sweep], held, actionId)
      : redoRows
  return new ReversalSet({ branchId, rows, redoRows, held })
}

/** Row keys for the set's rows and for every delete holding a row it writes. */
export function reversalLockKeys(set: ReversalSet): RowLockKey[] {
  const holders = set.rows.flatMap((d) => {
    const held = set.held.byRow.get(heldKey(d.targetTable, d.targetId))
    return held ? [held.holder] : []
  })
  return deltaLockKeys([...set.rows, ...holders])
}
