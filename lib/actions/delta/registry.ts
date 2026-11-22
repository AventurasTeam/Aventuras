import { and, eq, getTableColumns } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { ZodType } from 'zod'

import type { Delta, SqlOp } from '@/lib/db'
import { isEmbeddedSourceTable } from '@/lib/db'

import type { DbCtx, NoopMark, PipelineAction } from '../types'
import { schemaArrayPaths } from './delta-encoding'
import type { TermMatch } from './term-list'

export type DeltaOp = 'create' | 'update' | 'delete'

export type StorePatch =
  | { op: 'create'; id: string; row: Record<string, unknown> }
  | { op: 'update'; id: string; columns: Record<string, unknown> }
  | { op: 'delete'; id: string }

// A domain patcher closes over its working-set store; the store branch-guards.
export type StorePatcher = (branchId: string, patch: StorePatch) => void

export type Rows = Record<string, unknown>[]

export type CascadeRun<C> = (
  branchId: string,
  targetId: string,
  ctx: DbCtx,
) => Promise<{ ops: SqlOp[]; children: C }>

/**
 * `tables`: the child tables a delete removes, by registered name. `run` is **delete-op-only** —
 * reversing a `create` must not read it (`docs/generation-pipeline.md` → Reverse-replay).
 */
export type Cascade<T extends string = string> = {
  tables: readonly T[]
  run: CascadeRun<Record<T, Rows>>
}

/**
 * Rows the same action group creates, by `createdKey`, each with the row its create wrote (null when
 * the outcome carried no store patch) — handlers read pre-group state.
 */
export type GroupScope = {
  readonly created: ReadonlyMap<string, Readonly<Record<string, unknown>> | null>
}

export function createdKey(table: string, id: string): string {
  return `${table}:${id}`
}

export { TARGET_NOT_FOUND } from '../types'

/**
 * The first updatable key a patch carries as `undefined`. Drizzle skips such a key, so the
 * row keeps its value while the store, the undo payload and History would record a write.
 */
export function undefinedColumn(patch: object, columns: readonly string[]): string | undefined {
  const values = patch as Record<string, unknown>
  return columns.find((col) => col in values && values[col] === undefined)
}

type KeysOf<T> = T extends unknown ? keyof T : never

/**
 * True when an update patch's type and the column list its handler loops over name the same keys
 * (every member of a union patch counted). A key in the type alone compiles and is never written.
 */
export type PatchMatchesColumns<Patch, Columns extends readonly string[]> = [
  Exclude<KeysOf<Patch>, Columns[number]>,
  Exclude<Columns[number], KeysOf<Patch>>,
] extends [never, never]
  ? true
  : false

export type HandlerOutcome =
  | { status: 'rejected'; reason: string; code: 'noop'; mark?: NoopMark }
  // Deliberately a bare string: each action family funnels its OWN rejection vocabulary
  // through here, so a single union would couple taxonomies with no reason to agree.
  | { status: 'rejected'; reason: string; code?: string; mark?: never }
  | {
      status: 'ok'
      targetTable: string
      targetId: string
      op: DeltaOp
      undoPayload: Record<string, unknown> | null
      ops: SqlOp[]
      patch: StorePatch | null
    }

/**
 * A refusal the turn survives (redundant action, or a user edit won); a plain rejection reverses
 * the turn. `mark` (C11): a restated value or a gone row; null for a broken rule or a user edit.
 */
export function noopRefusal(reason: string, mark: NoopMark | null): HandlerOutcome {
  return mark === null
    ? { status: 'rejected', reason, code: 'noop' }
    : { status: 'rejected', reason, code: 'noop', mark }
}

/** `actionId`: the write's own, for a handler that reports an outcome against its run. */
export type HandlerCtx = DbCtx & { actionId?: string }

export type ActionHandler = (
  action: PipelineAction,
  branchId: string,
  ctx: HandlerCtx,
  /** Present on the group path only. */
  group?: GroupScope,
) => Promise<HandlerOutcome> | HandlerOutcome

export type TableDescriptor = { table: SQLiteTable; idCol: SQLiteColumn; branchCol?: SQLiteColumn }

// Shared by undo (reverse-replay.ts) and redo (redo.ts) — both target the same
// row for a given delta and descriptor.
export function whereForDelta(
  descriptor: TableDescriptor,
  delta: Pick<Delta, 'branchId' | 'targetId'>,
) {
  return descriptor.branchCol
    ? and(eq(descriptor.branchCol, delta.branchId), eq(descriptor.idCol, delta.targetId))
    : eq(descriptor.idCol, delta.targetId)
}

/** The table's branch column's key on a drizzle row object, or undefined for a table with none. */
export function branchKeyOf(descriptor: TableDescriptor): string | undefined {
  const { branchCol } = descriptor
  if (branchCol === undefined) return undefined
  return Object.entries(getTableColumns(descriptor.table)).find(
    ([, column]) => column === branchCol,
  )?.[0]
}

/** A string list a reversal undoes term by term: a column, or an array `path` inside a schema-backed one. */
export type TermListField = {
  readonly column: string
  readonly path?: readonly string[]
  readonly match: TermMatch
}

/** A count a reversal undoes as a counter: relative writes shift it, the rest set it. */
export type CounterField = {
  readonly column: string
  readonly isRelative: (delta: Delta) => boolean
}

export type DomainRegistration = {
  table: string
  descriptor: TableDescriptor
  columnSchemas: Record<string, ZodType>
  handlers: Record<string, ActionHandler>
  patcher?: StorePatcher
  cascade?: Cascade
  /**
   * Row exists while any is non-null; a reversal nulling them all deletes it. Another invariant
   * spanning columns needs a one-field group: `docs/generation-pipeline.md` → Reverse-replay.
   */
  rowKeepingColumns?: readonly [string, ...string[]]
  /** Every array in a schema-backed column that declares one must be declared. */
  termLists?: readonly TermListField[]
  counter?: CounterField
}

export type TableEntry = Omit<DomainRegistration, 'handlers'>

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
  checkFieldKinds(reg)
  const { handlers, ...tableEntry } = reg
  tableRegistry.set(reg.table, tableEntry)
  for (const [kind, handler] of Object.entries(handlers)) {
    actionRegistry.set(kind, { table: reg.table, handler })
  }
}

const pathKey = (column: string, path: readonly string[]) => [column, ...path].join('.')

// A misdeclared list would undo as a whole value, the bug the declaration exists to prevent.
function checkFieldKinds(reg: DomainRegistration): void {
  const columns = getTableColumns(reg.descriptor.table)
  const declared = new Set<string>()
  for (const { column, path = [] } of reg.termLists ?? []) {
    if (!Object.hasOwn(columns, column))
      throw new Error(`register: ${reg.table} has no column ${column} to list terms in`)
    const schema = reg.columnSchemas[column]
    if (path.length > 0) {
      const arrays = schema ? schemaArrayPaths(schema).map((p) => pathKey(column, p)) : []
      if (!arrays.includes(pathKey(column, path)))
        throw new Error(`register: ${reg.table}.${pathKey(column, path)} is not an array`)
    } else if (schema)
      throw new Error(`register: ${reg.table}.${column} is schema-backed; declare its array paths`)
    declared.add(pathKey(column, path))
  }
  for (const column of new Set((reg.termLists ?? []).map((list) => list.column))) {
    const schema = reg.columnSchemas[column]
    if (!schema) continue
    const missing = schemaArrayPaths(schema).find((p) => !declared.has(pathKey(column, p)))
    if (missing)
      throw new Error(`register: ${reg.table}.${pathKey(column, missing)} is an undeclared list`)
  }
  const counter = reg.counter?.column
  if (counter !== undefined && (!Object.hasOwn(columns, counter) || reg.columnSchemas[counter]))
    throw new Error(`register: ${reg.table} has no plain column ${counter} to count in`)
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
