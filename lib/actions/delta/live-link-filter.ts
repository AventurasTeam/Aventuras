import { and, eq, inArray } from 'drizzle-orm'

import { BIND_CHUNK, entities, happenings, type Delta } from '@/lib/db'

import type { DbCtx } from '../types'
import { linkRefs, type LiveRef } from './live-refs'
import { resolveByTable, type CascadeRestore } from './registry'

type Children = ReturnType<CascadeRestore>['children']

export type LiveLinkFilter = (branchId: string, children: Children) => Children

const REF_TABLES = { entities, happenings } as const

const refKey = (table: string, branchId: string, id: string) => `${table}:${branchId}:${id}`

function capturedChildren(delta: Delta): Children {
  if (delta.op !== 'delete') return []
  const restore = resolveByTable(delta.targetTable)?.restoreCascade
  return restore ? restore((delta.undoPayload ?? {}) as Record<string, unknown>).children : []
}

/**
 * C3: a delete's undo restores the links it captured, but a separate reversal may since have
 * removed the row at a link's far end. A named row counts as live by its state once the whole
 * plan has run — its oldest create in the plan removes it, a delete restores it — else by the DB.
 * A dropped relationship takes its translations with it.
 */
export async function liveLinkFilter(rows: readonly Delta[], ctx: DbCtx): Promise<LiveLinkFilter> {
  const fate = new Map<string, Delta>()
  for (const delta of rows) {
    if (delta.op === 'update' || !Object.hasOwn(REF_TABLES, delta.targetTable)) continue
    const key = refKey(delta.targetTable, delta.branchId, delta.targetId)
    const seen = fate.get(key)
    if (!seen || delta.logPosition < seen.logPosition) fate.set(key, delta)
  }

  const unresolved = new Map<
    string,
    { table: LiveRef['table']; branchId: string; ids: Set<string> }
  >()
  for (const delta of rows) {
    for (const child of capturedChildren(delta)) {
      for (const row of child.rows) {
        for (const ref of linkRefs(child.table, row)) {
          if (fate.has(refKey(ref.table, delta.branchId, ref.id))) continue
          const groupKey = `${ref.table}:${delta.branchId}`
          const group = unresolved.get(groupKey) ?? {
            table: ref.table,
            branchId: delta.branchId,
            ids: new Set<string>(),
          }
          group.ids.add(ref.id)
          unresolved.set(groupKey, group)
        }
      }
    }
  }

  const live = new Set<string>()
  for (const { table: name, branchId, ids } of unresolved.values()) {
    const table = REF_TABLES[name]
    const all = [...ids]
    for (let i = 0; i < all.length; i += BIND_CHUNK) {
      const found = await ctx.db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.branchId, branchId), inArray(table.id, all.slice(i, i + BIND_CHUNK))))
      for (const { id } of found) live.add(refKey(name, branchId, id))
    }
  }

  return (branchId, children) => {
    const isLive = (ref: LiveRef) => {
      const key = refKey(ref.table, branchId, ref.id)
      const last = fate.get(key)
      return last ? last.op === 'delete' : live.has(key)
    }
    const droppedRelationships = new Set<string>()
    const kept = children.map(({ table, rows: childRows }) => ({
      table,
      rows: childRows.filter((row) => {
        if (linkRefs(table, row).every(isLive)) return true
        if (table === 'character_relationships') droppedRelationships.add(row.id as string)
        return false
      }),
    }))
    return kept.map(({ table, rows: childRows }) => ({
      table,
      rows:
        table === 'translations'
          ? childRows.filter(
              (row) =>
                row.targetKind !== 'character_relationship' ||
                !droppedRelationships.has(row.targetId as string),
            )
          : childRows,
    }))
  }
}
