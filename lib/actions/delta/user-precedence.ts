import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm'

import { deltas, type Delta } from '@/lib/db'

import type { DbCtx } from '../types'

/** Noop reason for a classifier write a newer user edit of the same field outranks. */
export const USER_EDITED_SINCE_PROSE = 'user-edited-since-prose'

/** The source entry's prose position: its latest create or content-edit delta, 0 when it has none. */
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

/** `user_edit` deltas on one row logged after `since`, oldest first. */
export async function userEditsSince(
  ctx: DbCtx,
  branchId: string,
  targetTable: string,
  targetId: string,
  since: number,
): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetId, targetId),
        gt(deltas.logPosition, since),
        eq(deltas.targetTable, targetTable),
        eq(deltas.source, 'user_edit'),
      ),
    )
    .orderBy(asc(deltas.logPosition))) as Delta[]
}

/**
 * Whether one of these deltas created the row or changed `column` on it. Sound because
 * user updates record only the columns they changed, so an undo payload's keys are
 * exactly what the user wrote.
 */
export function wroteColumn(edits: readonly Delta[], column: string): boolean {
  return edits.some(
    (d) =>
      d.op === 'create' || (d.op === 'update' && d.undoPayload != null && column in d.undoPayload),
  )
}

/** Whether the user deleted a `character_relationships` row for this canonical pair after `since`. */
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
