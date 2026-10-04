import { and, asc, eq } from 'drizzle-orm'

import { deltas, type Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import type { DbCtx } from '../types'
import { capturedChildren } from './delete-cascade'
import { isPayloadMetaKey } from './delta-encoding'
import { rowRefs, type RefTable } from './live-refs'
import { resolveByTable } from './registry'

/** A row living on only in a delete's undo_payload (generation-pipeline.md → Reverse-replay). */
export type HeldRow = {
  readonly table: string
  readonly id: string
  /** The delete still in the log whose payload holds the row. */
  readonly holder: Delta
  /** `target`: the holder's own row. `captured`: a child under one of its cascade keys. */
  readonly place: 'target' | 'captured'
  /** The held copy: the payload minus cascade and meta keys for a target, the child row otherwise. */
  readonly row: Readonly<Record<string, unknown>>
}

export type HeldRowIndex = {
  /** Keyed by `heldKey(table, id)`. */
  readonly byRow: ReadonlyMap<string, HeldRow>
  /** Held rows naming `table:id` through REF_COLUMNS. */
  naming(table: RefTable, id: string): readonly HeldRow[]
}

export function heldKey(table: string, id: string): string {
  return `${table}:${id}`
}

export const EMPTY_HELD_ROWS: HeldRowIndex = { byRow: new Map(), naming: () => [] }

function heldBy(holder: Delta): HeldRow[] {
  const payload = holder.undoPayload ?? {}
  const { children, cascadeKeys } = capturedChildren(
    resolveByTable(holder.targetTable)?.cascade,
    payload,
  )
  const target = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !cascadeKeys.includes(key) && !isPayloadMetaKey(key)),
  )
  return [
    { table: holder.targetTable, id: holder.targetId, holder, place: 'target', row: target },
    ...children.flatMap(({ table, rows }) =>
      rows.map((row) => ({ table, id: row.id as string, holder, place: 'captured' as const, row })),
    ),
  ]
}

/** Every row the branch's deletes hold, read in one query. */
export async function loadHeldRows(ctx: DbCtx, branchId: string): Promise<HeldRowIndex> {
  const deletes = (await ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), eq(deltas.op, 'delete')))
    .orderBy(asc(deltas.logPosition))) as Delta[]

  const byRow = new Map<string, HeldRow>()
  for (const holder of deletes) {
    for (const held of heldBy(holder)) {
      const key = heldKey(held.table, held.id)
      const seen = byRow.get(key)
      if (seen) {
        // Deleting a held row again needs its delete undone first, so a second holder is a broken log.
        logger.error('action_layer.row_held_twice', {
          table: held.table,
          id: held.id,
          holders: [seen.holder.id, held.holder.id],
        })
        if (seen.holder.logPosition > held.holder.logPosition) continue
      }
      byRow.set(key, held)
    }
  }

  const naming = new Map<string, HeldRow[]>()
  for (const held of byRow.values()) {
    for (const ref of rowRefs(held.table, held.row)) {
      const key = heldKey(ref.table, ref.id)
      const list = naming.get(key)
      if (list) list.push(held)
      else naming.set(key, [held])
    }
  }

  return { byRow, naming: (table, id) => naming.get(heldKey(table, id)) ?? [] }
}
