import { and, eq, inArray } from 'drizzle-orm'

import { chunked, type Delta } from '@/lib/db'

import type { DbCtx } from '../types'
import { capturedChildren, type CapturedChildren as Children } from './delete-cascade'
import { heldKey, type HeldKey } from './held-rows'
import { isRefTable, rowRefs, type LiveRef, type RefTable } from './live-refs'
import { resolveByTable } from './registry'

export type LiveLinkFilter = (branchId: string, children: Children) => Children

const refKey = (table: string, branchId: string, id: string) => `${table}:${branchId}:${id}`

function capturedBy(delta: Delta): Children {
  if (delta.op !== 'delete') return []
  const payload = (delta.undoPayload ?? {}) as Record<string, unknown>
  return capturedChildren(resolveByTable(delta.targetTable)?.cascade, payload).children
}

function capturedKeys(children: Children): Set<HeldKey> {
  return new Set(
    children.flatMap(({ table, rows }) => rows.map((row) => heldKey(table, row.id as string))),
  )
}

const size = (children: Children) => children.reduce((n, child) => n + child.rows.length, 0)

/**
 * Drops captured rows naming a row that is dead once the plan has run, cascading to rows naming
 * those. Liveness: the row's oldest delta in the plan (a create removes it, a delete restores it),
 * else this undo's own restores, else the DB.
 */
export async function liveLinkFilter(rows: readonly Delta[], ctx: DbCtx): Promise<LiveLinkFilter> {
  const fate = new Map<string, Delta>()
  for (const delta of rows) {
    if (delta.op === 'update' || !isRefTable(delta.targetTable)) continue
    // The planner may keep a row-keeping row; if not, the closure already took every row naming it.
    if (delta.op === 'create' && resolveByTable(delta.targetTable)?.rowKeepingColumns) continue
    const key = refKey(delta.targetTable, delta.branchId, delta.targetId)
    const seen = fate.get(key)
    if (!seen || delta.logPosition < seen.logPosition) fate.set(key, delta)
  }

  const unresolved = new Map<string, { table: RefTable; branchId: string; ids: Set<string> }>()
  for (const delta of rows) {
    const children = capturedBy(delta)
    const restoredHere = capturedKeys(children)
    for (const child of children) {
      for (const row of child.rows) {
        for (const ref of rowRefs(child.table, row)) {
          if (fate.has(refKey(ref.table, delta.branchId, ref.id))) continue
          if (restoredHere.has(heldKey(ref.table, ref.id))) continue
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
    const entry = resolveByTable(name)
    if (!entry) throw new Error(`liveLinkFilter: ${name} is not a registered table`)
    const { table, idCol, branchCol } = entry.descriptor
    for (const chunk of chunked([...ids])) {
      const found = await ctx.db
        .select({ id: idCol })
        .from(table)
        .where(
          branchCol ? and(eq(branchCol, branchId), inArray(idCol, chunk)) : inArray(idCol, chunk),
        )
      for (const { id } of found) if (typeof id === 'string') live.add(refKey(name, branchId, id))
    }
  }

  return (branchId, children) => {
    let kept = children
    for (;;) {
      const restoredHere = capturedKeys(kept)
      const isLive = (ref: LiveRef) => {
        const key = refKey(ref.table, branchId, ref.id)
        const last = fate.get(key)
        if (last) return last.op === 'delete'
        return restoredHere.has(heldKey(ref.table, ref.id)) || live.has(key)
      }
      const next = kept.map(({ table, rows: childRows }) => ({
        table,
        rows: childRows.filter((row) => rowRefs(table, row).every(isLive)),
      }))
      // Rows only drop, so an unchanged count means nothing did.
      if (size(next) === size(kept)) return next
      kept = next
    }
  }
}
