import { and, eq, getTableColumns } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { ZodType } from 'zod'

import type { Delta, SqlOp } from '@/lib/db'
import { isEmbeddedSourceTable } from '@/lib/db'

import type { DbCtx, PipelineAction } from '../types'

export type DeltaOp = 'create' | 'update' | 'delete'

export type StorePatch =
  | { op: 'create'; id: string; row: Record<string, unknown> }
  | { op: 'update'; id: string; columns: Record<string, unknown> }
  | { op: 'delete'; id: string }

// A domain patcher closes over its working-set store; the store branch-guards.
export type StorePatcher = (branchId: string, patch: StorePatch) => void

// Extracts cascaded child rows from a delete delta's undo payload; the engine
// strips the declared keys to recover the clean parent row.
export type CascadeRestore = (undoPayload: Record<string, unknown>) => {
  /** Child rows to re-insert, keyed by their own registered table name. */
  children: { table: string; rows: Record<string, unknown>[] }[]
  /** Keys in the undo payload that belong to cascaded children; engine strips these. */
  cascadeKeys: string[]
}

/**
 * Replays the forward delete's cascade; returns child rows so the caller can emit store patches.
 * **Delete-op-only** — reversing a `create` must not read this; see
 * `docs/generation-pipeline.md` → Reverse-replay.
 */
export type CascadeDeleteOps = (
  branchId: string,
  targetId: string,
  ctx: DbCtx,
) => Promise<{
  ops: SqlOp[]
  children: Record<string, Record<string, unknown>[]>
}>

/**
 * Rows created earlier in the same action group, as `createdKey`s — handlers read pre-group state.
 */
export type GroupScope = { readonly created: ReadonlySet<string> }

export function createdKey(table: string, id: string): string {
  return `${table}:${id}`
}

export type HandlerOutcome =
  // Deliberately a bare string: each action family funnels its OWN rejection vocabulary
  // through here, so a single union would couple taxonomies with no reason to agree.
  | { status: 'rejected'; reason: string; code?: string }
  | {
      status: 'ok'
      targetTable: string
      targetId: string
      op: DeltaOp
      undoPayload: Record<string, unknown> | null
      ops: SqlOp[]
      patch: StorePatch | null
      /** Rows a delete's cascade removed; the runner patches their stores after the commit. */
      cascadePatches?: readonly { table: string; patch: StorePatch }[]
    }

export type ActionHandler = (
  action: PipelineAction,
  branchId: string,
  ctx: DbCtx,
  /** Present on the group path only. */
  group?: GroupScope,
) => Promise<HandlerOutcome> | HandlerOutcome

export type TableDescriptor = { table: SQLiteTable; idCol: SQLiteColumn; branchCol?: SQLiteColumn }

// Shared by undo (reverse-replay.ts) and redo (redo.ts) — both target the same
// row for a given delta and descriptor.
export function whereForDelta(descriptor: TableDescriptor, delta: Delta) {
  return descriptor.branchCol
    ? and(eq(descriptor.branchCol, delta.branchId), eq(descriptor.idCol, delta.targetId))
    : eq(descriptor.idCol, delta.targetId)
}

export type DomainRegistration = {
  table: string
  descriptor: TableDescriptor
  columnSchemas: Record<string, ZodType>
  handlers: Record<string, ActionHandler>
  patcher?: StorePatcher
  restoreCascade?: CascadeRestore
  cascadeDeleteOps?: CascadeDeleteOps
  /**
   * Row exists while any of these is non-null; a reversal nulling them all deletes it instead.
   * No other invariant may span columns. See `docs/generation-pipeline.md` → Reverse-replay.
   */
  rowKeepingColumns?: readonly [string, ...string[]]
}

type TableEntry = Omit<DomainRegistration, 'handlers'>

const actionRegistry = new Map<string, { table: string; handler: ActionHandler }>()
const tableRegistry = new Map<string, TableEntry>()

export function register(reg: DomainRegistration): void {
  // The tombstone arm deletes without a vector sweep, so an embedded table here would orphan vectors.
  if (reg.rowKeepingColumns && isEmbeddedSourceTable(reg.table))
    throw new Error(
      `register: ${reg.table} declares rowKeepingColumns; a tombstone reversal would orphan its vectors`,
    )

  // A misspelled name, or none, reads as null on every row: each update reversal would delete.
  if (reg.rowKeepingColumns) {
    if (reg.rowKeepingColumns.length === 0)
      throw new Error(`register: ${reg.table} lists no row-keeping column`)
    const columns = getTableColumns(reg.descriptor.table)
    for (const col of reg.rowKeepingColumns) {
      if (!Object.hasOwn(columns, col))
        throw new Error(`register: ${reg.table} has no column ${col} to keep rows by`)
    }
  }
  const { handlers, ...tableEntry } = reg
  tableRegistry.set(reg.table, tableEntry)
  for (const [kind, handler] of Object.entries(handlers)) {
    actionRegistry.set(kind, { table: reg.table, handler })
  }
}

export function resolveByActionKind(kind: string) {
  return actionRegistry.get(kind)
}
export function resolveByTable(table: string) {
  return tableRegistry.get(table)
}

// Test-only: registration is process-global; tests that register fixtures reset first.
export function __resetRegistry(): void {
  actionRegistry.clear()
  tableRegistry.clear()
}
