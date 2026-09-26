import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm'

import { BIND_CHUNK, deltas, type Delta } from '@/lib/db'

import { isUserOriginatedSource, type DbCtx } from '../types'

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
  targetTable: string,
  targetId: string,
  since: number,
): Promise<Delta[]> {
  return rowDeltasAfter(ctx, branchId, targetTable, [targetId], since, true)
}

/** `user_edit` deltas on one row logged after the source entry's prose, oldest first. */
export async function userEditsSinceProse(
  ctx: DbCtx,
  branchId: string,
  targetTable: string,
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
    for (let i = 0; i < ids.length; i += BIND_CHUNK) {
      const chunk = ids.slice(i, i + BIND_CHUNK)
      edits.push(...(await rowDeltasAfter(ctx, branchId, targetTable, chunk, since, true)))
    }
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
  targetTable: string,
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

/** Whether one of these deltas created the row or changed `column` on it. */
export function wroteColumn(edits: readonly Delta[], column: string): boolean {
  return edits.some((d) => d.op === 'create' || (d.op === 'update' && carriesColumn(d, column)))
}

/** Whether the user deleted a `character_relationships` row for this pair after `since`. */
export async function userDeletedPairSince(
  ctx: DbCtx,
  branchId: string,
  aId: string,
  bId: string,
  since: number,
): Promise<boolean> {
  // By pair, not row id: a pair re-created after the delete is a new row. A delete's
  // undo payload is the whole row, so it still names the pair.
  const [hit] = await ctx.db
    .select({ id: deltas.id })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        gt(deltas.logPosition, since),
        eq(deltas.targetTable, 'character_relationships'),
        eq(deltas.op, 'delete'),
        eq(deltas.source, 'user_edit'),
        sql`json_extract(${deltas.undoPayload}, '$.aId') = ${aId}`,
        sql`json_extract(${deltas.undoPayload}, '$.bId') = ${bId}`,
      ),
    )
    .limit(1)
  return hit !== undefined
}
