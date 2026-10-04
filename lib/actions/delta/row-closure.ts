import { and, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm'

import { BIND_CHUNK, deltas, happeningAwareness, happeningInvolvements, type Delta } from '@/lib/db'

import type { DbCtx } from '../types'
import { EMPTY_HELD_ROWS, heldKey, loadHeldRows, type HeldRowIndex } from './held-rows'
import { isRefTable, referrersOf } from './live-refs'
import { resolveByTable } from './registry'
import { ReversalIntegrityError } from './replay-errors'
import { deltaLockKeys, type RowLockKey } from './row-locks'
import { userEditsOutliving, wroteColumn } from './user-precedence'

// A child row points at its parent by id alone (FK-less), so nothing deletes it with the parent.
const CHILD_TABLES = {
  happenings: [
    { name: 'happening_involvements', table: happeningInvolvements },
    { name: 'happening_awareness', table: happeningAwareness },
  ],
} as const

/**
 * `rows` widened by every delta on a row one of its `create`s will delete, whatever that delta's
 * source: the row's own later writes, and its child rows' writes, a deleted child's included.
 * Left out, a later user edit is stranded in the log pointing at nothing (generation-pipeline.md
 * → Reverse-replay). A later `delete` of the row stays out, since undoing it would restore
 * children under a parent the create's undo then deletes; so does a table whose create-undo keeps
 * rows a user wrote to. Sorted newest-first for replay.
 */
export async function closeOverRemovedRows(rows: readonly Delta[], ctx: DbCtx): Promise<Delta[]> {
  const removed = rows.filter(
    (d) => d.op === 'create' && resolveByTable(d.targetTable)?.rowKeepingColumns == null,
  )
  const byId = new Map(rows.map((d) => [d.id, d]))
  const add = (found: readonly Delta[]) => {
    for (const d of found) if (!byId.has(d.id)) byId.set(d.id, d)
  }

  const groups = new Map<string, { branchId: string; targetTable: string; ids: string[] }>()
  for (const d of removed) {
    const key = `${d.branchId}:${d.targetTable}`
    const group = groups.get(key) ?? { branchId: d.branchId, targetTable: d.targetTable, ids: [] }
    group.ids.push(d.targetId)
    groups.set(key, group)
  }

  for (const { branchId, targetTable, ids } of groups.values()) {
    add(
      (await ctx.db
        .select()
        .from(deltas)
        .where(
          and(
            eq(deltas.branchId, branchId),
            eq(deltas.targetTable, targetTable),
            inArray(deltas.targetId, ids),
            ne(deltas.op, 'delete'),
          ),
        )) as Delta[],
    )
    for (const child of CHILD_TABLES[targetTable as keyof typeof CHILD_TABLES] ?? []) {
      const live = await ctx.db
        .select({ id: child.table.id })
        .from(child.table)
        .where(and(eq(child.table.branchId, branchId), inArray(child.table.happeningId, ids)))
      // A child the user already deleted is gone from its table; its delete's undo payload
      // still names the parent, and leaving its history out strands that delete.
      const deleted = await ctx.db
        .select({ id: deltas.targetId })
        .from(deltas)
        .where(
          and(
            eq(deltas.branchId, branchId),
            eq(deltas.targetTable, child.name),
            eq(deltas.op, 'delete'),
            inArray(sql`json_extract(${deltas.undoPayload}, '$.happeningId')`, ids),
          ),
        )
      const childIds = [...new Set([...live, ...deleted].map((r) => r.id))]
      if (childIds.length === 0) continue
      add(
        (await ctx.db
          .select()
          .from(deltas)
          .where(
            and(
              eq(deltas.branchId, branchId),
              eq(deltas.targetTable, child.name),
              inArray(deltas.targetId, childIds),
            ),
          )) as Delta[],
      )
    }
  }

  return [...byId.values()].sort((a, b) => b.logPosition - a.logPosition)
}

declare const reversalSetBrand: unique symbol

/** A closed reversal set; minted only by selectReversalSet, so no path reverses an unclosed one. */
export type ReversalSet = {
  readonly [reversalSetBrand]: true
  readonly branchId: string
  /** Every delta the reversal replays and prunes, newest-first. */
  readonly rows: readonly Delta[]
  /** The target and what the closure reaches from it, newest-first: what CTRL-Z's redo restores. */
  readonly redoRows: readonly Delta[]
  /** The rows the branch's deletes held when the set was selected. */
  readonly held: HeldRowIndex
}

export type ReversalSeed = {
  readonly branchId: string
  /** The action being undone, or a path's whole selection. */
  readonly target: readonly Delta[]
  /** Rows reversed because prose moved; redo leaves them, and what only they reach, to re-derivation. */
  readonly sweep?: readonly Delta[]
}

type RowRef = { readonly table: string; readonly id: string }

const mint = (set: Omit<ReversalSet, typeof reversalSetBrand>) => set as ReversalSet

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
async function writesTo(ctx: DbCtx, branchId: string, rows: readonly RowRef[]): Promise<Delta[]> {
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

/** Ids of the row-keeping creates in `seed` that a later user write outside it kept. */
async function userKeptCreates(ctx: DbCtx, seed: readonly Delta[]): Promise<ReadonlySet<string>> {
  const keepingColumns = (d: Delta) =>
    d.op === 'create' ? resolveByTable(d.targetTable)?.rowKeepingColumns : undefined
  if (!seed.some((d) => keepingColumns(d) !== undefined)) return new Set()
  const outliving = await userEditsOutliving(ctx, seed, (d) => keepingColumns(d) !== undefined)
  return new Set(
    seed
      .filter((d) => keepingColumns(d)?.some((col) => wroteColumn(outliving.get(d.id) ?? [], col)))
      .map((d) => d.id),
  )
}

// The fixed point of generation-pipeline.md → Reverse-replay: rows the seed's creates remove,
// then every row naming a removed row — live, held, or deleted on its own — until none joins.
async function closeOver(
  ctx: DbCtx,
  branchId: string,
  seed: readonly Delta[],
  held: HeldRowIndex,
  actionId: string,
): Promise<Delta[]> {
  const set = new Map(seed.map((d) => [d.id, d]))
  const removed = new Set<string>()
  const byReference = new Set<string>()
  let frontier: RowRef[] = []
  const remove = (row: RowRef, viaReference: boolean) => {
    const key = heldKey(row.table, row.id)
    if (removed.has(key)) return
    removed.add(key)
    if (viaReference) byReference.add(key)
    frontier.push({ table: row.table, id: row.id })
  }

  const kept = await userKeptCreates(ctx, seed)
  for (const d of seed) {
    if (d.op === 'create' && !kept.has(d.id))
      remove({ table: d.targetTable, id: d.targetId }, false)
  }

  while (frontier.length > 0) {
    const round = frontier
    frontier = []
    const writes = await writesTo(ctx, branchId, round)
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
  if (all.length === 0) return mint({ branchId, rows: [], redoRows: [], held: EMPTY_HELD_ROWS })

  const held = await loadHeldRows(ctx, branchId)
  const { actionId } = all[0]
  const redoRows = target.length > 0 ? await closeOver(ctx, branchId, target, held, actionId) : []
  const rows =
    sweep.length > 0
      ? await closeOver(ctx, branchId, [...redoRows, ...sweep], held, actionId)
      : redoRows
  return mint({ branchId, rows, redoRows, held })
}

/** Row keys for the set's rows and for every delete holding a row it writes. */
export function reversalLockKeys(set: ReversalSet): RowLockKey[] {
  const holders = set.rows.flatMap((d) => {
    const held = set.held.byRow.get(heldKey(d.targetTable, d.targetId))
    return held ? [held.holder] : []
  })
  return deltaLockKeys([...set.rows, ...holders])
}
