import { desc, eq } from 'drizzle-orm'

import type { Delta, SqlOp } from '@/lib/db'
import { deltas, embeddedFieldsForTable, isEmbeddedSourceTable } from '@/lib/db'

import type { DbCtx } from '../types'
import { applyUndoPayload } from './delta-encoding'
import { resolveByTable, whereForDelta, type StorePatch } from './registry'

export class DeltaReplayError extends Error {
  readonly actionId: string
  // True when the DB transaction already committed (deltas pruned) and the failure
  // is post-commit store sync — callers must not retry it as a rollback failure.
  readonly committed: boolean
  constructor(message: string, opts: { cause: unknown; actionId: string; committed?: boolean }) {
    super(message, { cause: opts.cause })
    this.name = 'DeltaReplayError'
    this.actionId = opts.actionId
    this.committed = opts.committed ?? false
  }
}

type PatchEmission = { table: string; branchId: string; patch: StorePatch }

// Membership only, never a value compare: an undo restores a prior value by
// construction, and a degenerate value-equal undo costs one revalidation hash.
function undoDirtiesVector(targetTable: string, payloadKeys: readonly string[]): boolean {
  const fields = embeddedFieldsForTable(targetTable)
  return fields !== undefined && payloadKeys.some((key) => fields.includes(key))
}

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
    const { table } = entry.descriptor
    const where = whereForDelta(entry.descriptor, delta)
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
      const { children, cascadeKeys } = entry.restoreCascade
        ? entry.restoreCascade(full)
        : { children: [], cascadeKeys: [] }

      const rowData = { ...full }
      for (const key of cascadeKeys) {
        delete rowData[key]
      }
      // The payload's flag was accurate at delete time, but an embedder swap since
      // then re-embeds only LIVE rows, so the vector can be gone while it reads clean.
      if (isEmbeddedSourceTable(delta.targetTable)) rowData.embeddingStale = 1

      working.set(key, { ...rowData })
      ops.push(ctx.db.insert(table).values(rowData).toSQL())
      patches.push({
        table: delta.targetTable,
        branchId: delta.branchId,
        patch: { op: 'create', id: delta.targetId, row: rowData },
      })

      for (const { table: childTableName, rows: childRows } of children) {
        // drizzle's values() throws on an empty array, so an empty child set must
        // never reach it — a domain declaring one is saying "nothing to restore".
        if (childRows.length === 0) continue
        const childEntry = resolveByTable(childTableName)
        if (!childEntry) throw new Error(`reverse-replay: unknown child table ${childTableName}`)
        const { table: childTable } = childEntry.descriptor
        const childIsEmbedded = isEmbeddedSourceTable(childTableName)
        const restoredChildren: Record<string, unknown>[] = childIsEmbedded
          ? childRows.map((childRow) => ({ ...childRow, embeddingStale: 1 }))
          : childRows
        ops.push(ctx.db.insert(childTable).values(restoredChildren).toSQL())
        for (const childRow of restoredChildren) {
          patches.push({
            table: childTableName,
            branchId: delta.branchId,
            patch: { op: 'create', id: childRow.id as string, row: childRow },
          })
        }
      }
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
      // A null partial on a schema-backed column means the column itself was
      // null pre-change — no field-wise overlay can express that. Falls through
      // to the same whole-value restore a scalar column takes.
      const value =
        schema && partial !== null
          ? applyUndoPayload(
              schema,
              (row[col] as Record<string, unknown>) ?? {},
              partial as Record<string, unknown>,
            )
          : partial
      restored[col] = value
      row[col] = value // thread into the working copy for later-in-DESC undos
    }
    // Revalidation (app-deps.ts) only ever CLEARS this flag, so nothing outside a writer
    // like this one sets it back to 1 — erring dirty is the self-correcting direction.
    if (undoDirtiesVector(delta.targetTable, Object.keys(payload))) {
      restored.embeddingStale = 1
      row.embeddingStale = 1
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
export async function reverseAndPruneDeltaRows(
  rows: Delta[],
  ctx: DbCtx,
  extraOps: readonly SqlOp[] = [],
): Promise<number> {
  if (rows.length === 0 && extraOps.length === 0) return 0
  const actionId = rows[0]?.actionId ?? 'rollback'
  let patches: PatchEmission[]
  try {
    const built = await buildUndoOps(rows, ctx)
    patches = built.patches
    const pruneOps = rows.map((r) => ctx.db.delete(deltas).where(eq(deltas.id, r.id)).toSQL())
    await ctx.runInTransaction([...built.ops, ...pruneOps, ...extraOps])
  } catch (e) {
    if (e instanceof DeltaReplayError) throw e
    throw new DeltaReplayError('Reverse-and-prune failed', { cause: e, actionId })
  }
  // Past the transaction the reversal + prune are committed; a patcher throw is a
  // store-sync failure, not a rollback failure. Flag committed so callers don't retry.
  try {
    for (const p of patches) resolveByTable(p.table)?.patcher?.(p.branchId, p.patch)
  } catch (e) {
    throw new DeltaReplayError('Post-commit patch sync failed', {
      cause: e,
      actionId,
      committed: true,
    })
  }
  return rows.length
}

/**
 * `settleOps` commits caller ops in the SAME transaction as the reversal, keyed on
 * the delta count so the caller can branch on it. Recovery uses it for the
 * `pipeline_runs` marker: written separately, a failure between the two leaves the
 * deltas reversed but the orphan open, and the next boot's replay is not idempotent
 * — undoing a `create` deletes (repeatable), undoing a `delete` re-inserts (conflicts),
 * so a transient error would harden into a permanent one.
 */
export async function reverseReplayDeltas(
  actionId: string,
  ctx: DbCtx,
  settleOps: (deltaCount: number) => readonly SqlOp[] = () => [],
): Promise<number> {
  try {
    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, actionId))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    const settle = settleOps(rows.length)
    if (rows.length === 0 && settle.length === 0) return 0

    const { ops, patches } = await buildUndoOps(rows, ctx)
    await ctx.runInTransaction([...ops, ...settle])
    // Action layer owns the patch: invert in the held-branch store after the tx.
    for (const p of patches) resolveByTable(p.table)?.patcher?.(p.branchId, p.patch)
    return rows.length
  } catch (e) {
    if (e instanceof DeltaReplayError) throw e
    throw new DeltaReplayError('Reverse-replay failed', { cause: e, actionId })
  }
}
