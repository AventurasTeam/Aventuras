import { and, desc, eq } from 'drizzle-orm'

import type { Delta, SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'

import type { DbCtx } from '../types'
import { applyUndoPayload } from './delta-encoding'
import { resolveByTable, type StorePatch } from './registry'

export class DeltaReplayError extends Error {
  readonly actionId: string
  constructor(message: string, opts: { cause: unknown; actionId: string }) {
    super(message, { cause: opts.cause })
    this.name = 'DeltaReplayError'
    this.actionId = opts.actionId
  }
}

type PatchEmission = { table: string; branchId: string; patch: StorePatch }

// Build undo ops for one action's deltas (already in log_position DESC order).
// A per-row working copy threads each op=update undo onto the prior one so multiple
// updates to the SAME row — even touching disjoint sub-keys of a JSON column —
// compose correctly instead of clobbering via stale-base whole-column overwrites.
async function buildUndoOps(
  rows: Delta[],
  ctx: DbCtx,
): Promise<{ ops: SqlOp[]; patches: PatchEmission[] }> {
  const working = new Map<string, Record<string, unknown>>()
  const ops: SqlOp[] = []
  const patches: PatchEmission[] = []

  for (const delta of rows) {
    const entry = resolveByTable(delta.targetTable)
    if (!entry) throw new Error(`reverse-replay: unknown target_table ${delta.targetTable}`)
    const { table, idCol, branchCol } = entry.descriptor
    const where = branchCol
      ? and(eq(branchCol, delta.branchId), eq(idCol, delta.targetId))
      : eq(idCol, delta.targetId)
    const key = `${delta.targetTable}:${delta.branchId}:${delta.targetId}`

    if (delta.op === 'create') {
      working.delete(key)
      ops.push(ctx.db.delete(table).where(where).toSQL())
      patches.push({
        table: delta.targetTable,
        branchId: delta.branchId,
        patch: { op: 'delete', id: delta.targetId },
      })
      continue
    }
    if (delta.op === 'delete') {
      const full = (delta.undoPayload ?? {}) as Record<string, unknown>
      working.set(key, { ...full })
      ops.push(ctx.db.insert(table).values(full).toSQL())
      patches.push({
        table: delta.targetTable,
        branchId: delta.branchId,
        patch: { op: 'create', id: delta.targetId, row: full },
      })
      continue
    }

    let row = working.get(key)
    if (!row) {
      const [current] = (await ctx.db.select().from(table).where(where)) as Record<
        string,
        unknown
      >[]
      row = { ...(current ?? {}) }
      working.set(key, row)
    }
    const payload = (delta.undoPayload ?? {}) as Record<string, unknown>
    const restored: Record<string, unknown> = {}
    for (const [col, partial] of Object.entries(payload)) {
      const schema = entry.columnSchemas[col]
      const value = schema
        ? applyUndoPayload(
            schema,
            (row[col] as Record<string, unknown>) ?? {},
            partial as Record<string, unknown>,
          )
        : partial // scalar column: whole-value restore
      restored[col] = value
      row[col] = value // thread into the working copy for later-in-DESC undos
    }
    ops.push(ctx.db.update(table).set(restored).where(where).toSQL())
    patches.push({
      table: delta.targetTable,
      branchId: delta.branchId,
      patch: { op: 'update', id: delta.targetId, columns: restored },
    })
  }

  return { ops, patches }
}

// Rollback path: reverse a pre-selected delta set AND prune those delta rows
// from the log in one transaction (gaps in log_position are expected). The
// actionId-scoped reverseReplayDeltas deliberately does not prune; this does.
export async function reverseAndPruneDeltaRows(rows: Delta[], ctx: DbCtx): Promise<number> {
  if (rows.length === 0) return 0
  try {
    const { ops, patches } = await buildUndoOps(rows, ctx)
    const pruneOps = rows.map((r) => ctx.db.delete(deltas).where(eq(deltas.id, r.id)).toSQL())
    await ctx.runInTransaction([...ops, ...pruneOps])
    for (const p of patches) resolveByTable(p.table)?.patcher?.(p.branchId, p.patch)
    return rows.length
  } catch (e) {
    if (e instanceof DeltaReplayError) throw e
    throw new DeltaReplayError('Reverse-and-prune failed', {
      cause: e,
      actionId: rows[0]?.actionId ?? 'rollback',
    })
  }
}

export async function reverseReplayDeltas(actionId: string, ctx: DbCtx): Promise<number> {
  try {
    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, actionId))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    if (rows.length === 0) return 0

    const { ops, patches } = await buildUndoOps(rows, ctx)
    await ctx.runInTransaction(ops)
    // Action layer owns the patch: invert in the held-branch store after the tx.
    for (const p of patches) resolveByTable(p.table)?.patcher?.(p.branchId, p.patch)
    return rows.length
  } catch (e) {
    if (e instanceof DeltaReplayError) throw e
    throw new DeltaReplayError('Reverse-replay failed', { cause: e, actionId })
  }
}
