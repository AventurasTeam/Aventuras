import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm'

import { chunked, deltas, type Delta } from '@/lib/db'

import { isUserOriginatedSource, type DbCtx } from '../types'
import { isPlainObject } from './delta-encoding'
import type { LockedTable } from './row-locks'

/** Noop reason for a classifier write a newer user edit of the same field outranks. */
export const USER_EDITED_SINCE_PROSE = 'user-edited-since-prose'

/** The source entry's latest create/content-edit delta position, 0 when it has none. */
export async function proseLogPosition(
  ctx: DbCtx,
  branchId: string,
  entryId: string,
): Promise<number> {
  const [row] = await ctx.db
    .select({ lp: deltas.logPosition })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetId, entryId),
        eq(deltas.targetTable, 'story_entries'),
        // isContentEditDelta's key-presence test: json_type is non-NULL even for a JSON null.
        or(
          eq(deltas.op, 'create'),
          and(
            eq(deltas.op, 'update'),
            sql`json_type(${deltas.undoPayload}, '$.content') IS NOT NULL`,
          ),
        ),
      ),
    )
    .orderBy(desc(deltas.logPosition))
    .limit(1)
  return row?.lp ?? 0
}

async function rowDeltasAfter(
  ctx: DbCtx,
  branchId: string,
  targetTable: string,
  targetIds: readonly string[],
  since: number,
  userOnly: boolean,
): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        inArray(deltas.targetId, [...targetIds]),
        gt(deltas.logPosition, since),
        eq(deltas.targetTable, targetTable),
        userOnly ? eq(deltas.source, 'user_edit') : undefined,
      ),
    )
    .orderBy(asc(deltas.logPosition))) as Delta[]
}

/** `user_edit` deltas on one row logged after `since`, oldest first. */
export function userEditsSince(
  ctx: DbCtx,
  branchId: string,
  targetTable: LockedTable,
  targetId: string,
  since: number,
): Promise<Delta[]> {
  return rowDeltasAfter(ctx, branchId, targetTable, [targetId], since, true)
}

/** `user_edit` deltas on one row logged after the source entry's prose, oldest first. */
export async function userEditsSinceProse(
  ctx: DbCtx,
  branchId: string,
  targetTable: LockedTable,
  targetId: string,
  proseEntryId: string,
): Promise<Delta[]> {
  const since = await proseLogPosition(ctx, branchId, proseEntryId)
  return userEditsSince(ctx, branchId, targetTable, targetId, since)
}

const rowKey = (d: Delta) => `${d.targetTable}:${d.branchId}:${d.targetId}`

function groupBy(items: readonly Delta[], key: (d: Delta) => string): Map<string, Delta[]> {
  const groups = new Map<string, Delta[]>()
  for (const item of items) {
    const group = groups.get(key(item))
    if (group) group.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}

/**
 * Maps each machine delta in `rows` that `wanted` accepts to the `user_edit` deltas on its
 * row logged after it that `rows` doesn't also reverse, oldest first. A user delta has none.
 */
export async function userEditsOutliving(
  ctx: DbCtx,
  rows: readonly Delta[],
  wanted: (delta: Delta) => boolean,
): Promise<ReadonlyMap<string, Delta[]>> {
  const reversed = new Set(rows.map((r) => r.id))
  const machine = rows.filter((d) => !isUserOriginatedSource(d.source) && wanted(d))
  const edits: Delta[] = []
  for (const group of groupBy(machine, (d) => `${d.branchId}:${d.targetTable}`).values()) {
    const { branchId, targetTable } = group[0]
    // One bound per table; each machine write below keeps only its own row's later edits.
    const since = group.reduce((min, d) => Math.min(min, d.logPosition), Infinity)
    const ids = [...new Set(group.map((d) => d.targetId))]
    for (const chunk of chunked(ids))
      edits.push(...(await rowDeltasAfter(ctx, branchId, targetTable, chunk, since, true)))
  }
  const outliving = edits.filter((e) => !reversed.has(e.id))
  const editsByRow = groupBy(outliving, rowKey)
  return new Map(
    machine.map((d) => [
      d.id,
      (editsByRow.get(rowKey(d)) ?? []).filter((e) => e.logPosition > d.logPosition),
    ]),
  )
}

/** Deltas of any source on one row logged after `since`, oldest first. */
export function rowDeltasSince(
  ctx: DbCtx,
  branchId: string,
  targetTable: LockedTable,
  targetId: string,
  since: number,
): Promise<Delta[]> {
  return rowDeltasAfter(ctx, branchId, targetTable, [targetId], since, false)
}

/**
 * Whether the delta recorded `column`'s prior value. User update paths (`updateEntity`, the
 * both-perspective upsert) drop unchanged columns, so a user update carries only changed ones.
 */
export function carriesColumn(delta: Delta, column: string): boolean {
  return delta.undoPayload != null && column in delta.undoPayload
}

/**
 * Whether the delta recorded a prior value at `path` inside `column`, at a path above it or at one
 * below it: the undo payload records only the sub-fields an update changed.
 */
function carriesPath(delta: Delta, column: string, path: readonly string[]): boolean {
  if (!carriesColumn(delta, column)) return false
  let node: unknown = delta.undoPayload?.[column]
  for (const key of path) {
    if (!isPlainObject(node)) return true
    if (!Object.hasOwn(node, key)) return false
    node = node[key]
  }
  return true
}

/** Whether one of these deltas created the row or changed `path` inside `column` on it. */
export function wrotePath(
  edits: readonly Delta[],
  column: string,
  path: readonly string[],
): boolean {
  return edits.some((d) => d.op === 'create' || (d.op === 'update' && carriesPath(d, column, path)))
}

/** Whether one of these deltas created the row or changed `column` on it. */
export function wroteColumn(edits: readonly Delta[], column: string): boolean {
  return wrotePath(edits, column, [])
}

/**
 * A user edit wrote a place's parent or unplaced flag, which only sits beside a null parent
 * (data-model.md → LocationState shape).
 */
export function wrotePlacement(edits: readonly Delta[]): boolean {
  return (
    wrotePath(edits, 'state', ['parent_location_id']) || wrotePath(edits, 'state', ['unplaced'])
  )
}

const PLACEMENT_PATHS: readonly string[] = ['parent_location_id', 'unplaced']

const COLLISION_FLAG_COLUMNS: readonly string[] = [
  'nameCollisionFlag',
  'nameCollisionPartnerId',
  'nameCollisionReason',
]

/**
 * A user edit wrote an entity's collision flag, partner or reason, which the table's CHECK holds
 * together (data-model.md → Authorship contract).
 */
export function wroteCollisionFlag(edits: readonly Delta[]): boolean {
  return COLLISION_FLAG_COLUMNS.some((column) => wroteColumn(edits, column))
}

const RETIREMENT_COLUMNS: readonly string[] = ['status', 'retiredReason']

/** A user edit wrote an entity's status or retired reason (data-model.md → Authorship contract). */
export function wroteRetirement(edits: readonly Delta[]): boolean {
  return RETIREMENT_COLUMNS.some((column) => wroteColumn(edits, column))
}

const THREAD_STATUS_COLUMNS: readonly string[] = ['status', 'resolvedAtEntryId']

/** A user edit wrote a thread's status or resolved-at entry (classifier.md → Threads → The row). */
export function wroteThreadStatus(edits: readonly Delta[]): boolean {
  return THREAD_STATUS_COLUMNS.some((column) => wroteColumn(edits, column))
}

/**
 * wrotePath, but a place's parent and unplaced mark, an entity's collision columns, an entity's
 * status and retired reason, and a thread's status and entry ref each count as one field
 * (cadence.md → User edits and classifier writes).
 */
export function wroteField(
  edits: readonly Delta[],
  table: string,
  column: string,
  path: readonly string[],
): boolean {
  if (table === 'entities') {
    if (column === 'state' && path.length === 1 && PLACEMENT_PATHS.includes(path[0]))
      return wrotePlacement(edits)
    if (path.length === 0 && COLLISION_FLAG_COLUMNS.includes(column))
      return wroteCollisionFlag(edits)
    if (path.length === 0 && RETIREMENT_COLUMNS.includes(column)) return wroteRetirement(edits)
  }
  if (table === 'threads' && THREAD_STATUS_COLUMNS.includes(column)) return wroteThreadStatus(edits)
  return wrotePath(edits, column, path)
}

// By natural key, not row id: a pair re-created after the delete is a new row. A delete's undo
// payload is the whole row, so it still names the key.
async function userDeletedRowSince(
  ctx: DbCtx,
  branchId: string,
  table: 'character_relationships' | 'happening_awareness',
  key: Readonly<Record<string, string>>,
  since: number,
): Promise<boolean> {
  const [hit] = await ctx.db
    .select({ id: deltas.id })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        gt(deltas.logPosition, since),
        eq(deltas.targetTable, table),
        eq(deltas.op, 'delete'),
        eq(deltas.source, 'user_edit'),
        ...Object.entries(key).map(
          ([column, value]) =>
            sql`json_extract(${deltas.undoPayload}, ${`$.${column}`}) = ${value}`,
        ),
      ),
    )
    .limit(1)
  return hit !== undefined
}

/** Whether the user deleted a `character_relationships` row for this pair after `since`. */
export function userDeletedPairSince(
  ctx: DbCtx,
  branchId: string,
  aId: string,
  bId: string,
  since: number,
): Promise<boolean> {
  return userDeletedRowSince(ctx, branchId, 'character_relationships', { aId, bId }, since)
}

/** Whether the user deleted the character's awareness row for the happening after `since`. */
export function userDeletedAwarenessSince(
  ctx: DbCtx,
  branchId: string,
  characterId: string,
  happeningId: string,
  since: number,
): Promise<boolean> {
  return userDeletedRowSince(
    ctx,
    branchId,
    'happening_awareness',
    { characterId, happeningId },
    since,
  )
}
