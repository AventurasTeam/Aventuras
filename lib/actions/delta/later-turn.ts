import { and, eq, gt, inArray, ne } from 'drizzle-orm'

import { chunked, deltas, storyEntries, type Delta } from '@/lib/db'
import { isRetrievalBumpOnly } from '@/lib/row-signals'

import type { DbCtx, GuardRow, PrecedenceTable } from '../types'

// By target_id, as resolveRollbackWindow finds a turn's create, whatever that delta's anchor.
const entryCreateJoin = and(
  eq(deltas.branchId, storyEntries.branchId),
  eq(deltas.targetTable, 'story_entries'),
  eq(deltas.targetId, storyEntries.id),
  eq(deltas.op, 'create'),
)

/**
 * The entries past E, the actions their `story_entries` creates ran under (their turns), and
 * E's create's log position, 0 when it has none.
 */
async function laterTurns(
  ctx: DbCtx,
  branchId: string,
  endEntryId: string,
): Promise<{
  entryIds: ReadonlySet<string>
  actionIds: ReadonlySet<string>
  endCreateLogPosition: number
}> {
  const ends = await ctx.db
    .select({ position: storyEntries.position, logPosition: deltas.logPosition })
    .from(storyEntries)
    .leftJoin(deltas, entryCreateJoin)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, endEntryId)))
  if (ends.length === 0)
    throw new Error(`laterTurnDeltas: end entry ${branchId}:${endEntryId} not found`)
  const endCreateLogPosition = Math.min(...ends.map((e) => e.logPosition ?? 0))
  const rows = await ctx.db
    .select({ entryId: storyEntries.id, actionId: deltas.actionId })
    .from(storyEntries)
    .leftJoin(deltas, entryCreateJoin)
    .where(and(eq(storyEntries.branchId, branchId), gt(storyEntries.position, ends[0].position)))
  const entryIds = new Set<string>()
  const actionIds = new Set<string>()
  for (const row of rows) {
    entryIds.add(row.entryId)
    if (row.actionId !== null) actionIds.add(row.actionId)
  }
  return { entryIds, actionIds, endCreateLogPosition }
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
 * `retrievalCount`-only update. An entry with no create delta names no action. Only deltas logged
 * after E's create are read.
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
            // Later turns log after E's create: the survival anchor's commit-order assumption.
            gt(deltas.logPosition, later.endCreateLogPosition),
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
