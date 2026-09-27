import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import { deltas, happeningAwareness, happeningInvolvements, type Delta } from '@/lib/db'

import type { DbCtx } from '../types'
import { resolveByTable } from './registry'

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
