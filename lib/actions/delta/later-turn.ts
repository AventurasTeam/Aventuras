import { and, eq, gt, inArray, ne } from 'drizzle-orm'

import { chunked, deltas, storyEntries, type Delta } from '@/lib/db'
import { isRetrievalBumpOnly } from '@/lib/row-signals'

import type { DbCtx, GuardRow, PrecedenceTable } from '../types'

/** The entries past E, and the actions their `story_entries` creates ran under: their turns. */
async function laterTurns(
  ctx: DbCtx,
  branchId: string,
  endEntryId: string,
): Promise<{ entryIds: ReadonlySet<string>; actionIds: ReadonlySet<string> }> {
  const [end] = await ctx.db
    .select({ position: storyEntries.position })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, endEntryId)))
  if (!end) throw new Error(`laterTurnDeltas: end entry ${branchId}:${endEntryId} not found`)
  // By target_id, as resolveRollbackWindow finds a turn's create, whatever that delta's anchor.
  const rows = await ctx.db
    .select({ entryId: storyEntries.id, actionId: deltas.actionId })
    .from(storyEntries)
    .leftJoin(
      deltas,
      and(
        eq(deltas.branchId, storyEntries.branchId),
        eq(deltas.targetTable, 'story_entries'),
        eq(deltas.targetId, storyEntries.id),
        eq(deltas.op, 'create'),
      ),
    )
    .where(and(eq(storyEntries.branchId, branchId), gt(storyEntries.position, end.position)))
  const entryIds = new Set<string>()
  const actionIds = new Set<string>()
  for (const row of rows) {
    entryIds.add(row.entryId)
    if (row.actionId !== null) actionIds.add(row.actionId)
  }
  return { entryIds, actionIds }
}

function idsByTable(rows: readonly GuardRow[]): Map<PrecedenceTable, string[]> {
  const byTable = new Map<PrecedenceTable, string[]>()
  for (const { table, id } of rows) {
    const ids = byTable.get(table) ?? []
    if (!ids.includes(id)) ids.push(id)
    byTable.set(table, ids)
  }
  return byTable
}

/**
 * C12: the deltas on `rows` a turn past E wrote, oldest first. Anchored on an entry positioned past
 * E, or null-anchored in the action that created one; never a `chapter_close` delta or a
 * `retrievalCount`-only update. An entry with no create delta names no action.
 */
export async function laterTurnDeltas(
  ctx: DbCtx,
  branchId: string,
  endEntryId: string,
  rows: readonly GuardRow[],
): Promise<Delta[]> {
  if (rows.length === 0) return []
  const later = await laterTurns(ctx, branchId, endEntryId)
  const found: Delta[] = []
  for (const [table, ids] of idsByTable(rows)) {
    for (const chunk of chunked(ids)) {
      const onRows = (await ctx.db
        .select()
        .from(deltas)
        .where(
          and(
            eq(deltas.branchId, branchId),
            eq(deltas.targetTable, table),
            inArray(deltas.targetId, chunk),
            ne(deltas.source, 'chapter_close'),
          ),
        )) as Delta[]
      found.push(...onRows)
    }
  }
  return found
    .filter((d) => !isRetrievalBumpOnly(d.op, d.undoPayload))
    .filter((d) =>
      d.entryId === null ? later.actionIds.has(d.actionId) : later.entryIds.has(d.entryId),
    )
    .sort((a, b) => a.logPosition - b.logPosition)
}
