import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { ZodType } from 'zod'

import type { SqlOp } from '@/lib/db'

import type { DbCtx, PipelineAction } from '../types'

export type DeltaOp = 'create' | 'update' | 'delete'

export type StorePatch =
  | { op: 'create'; id: string; row: Record<string, unknown> }
  | { op: 'update'; id: string; columns: Record<string, unknown> }
  | { op: 'delete'; id: string }

// A domain patcher closes over its working-set store; the store branch-guards.
export type StorePatcher = (branchId: string, patch: StorePatch) => void

export type HandlerOutcome =
  | { status: 'rejected'; reason: string; code?: string }
  | {
      status: 'ok'
      targetTable: string
      targetId: string
      op: DeltaOp
      undoPayload: Record<string, unknown> | null
      ops: SqlOp[]
      patch: StorePatch | null
    }

export type ActionHandler = (
  action: PipelineAction,
  branchId: string,
  ctx: DbCtx,
) => Promise<HandlerOutcome> | HandlerOutcome

export type TableDescriptor = { table: SQLiteTable; idCol: SQLiteColumn; branchCol?: SQLiteColumn }

export type DomainRegistration = {
  table: string
  descriptor: TableDescriptor
  columnSchemas: Record<string, ZodType>
  handlers: Record<string, ActionHandler>
  patcher?: StorePatcher
}

type TableEntry = Omit<DomainRegistration, 'handlers'>

const actionRegistry = new Map<string, { table: string; handler: ActionHandler }>()
const tableRegistry = new Map<string, TableEntry>()

export function register(reg: DomainRegistration): void {
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
