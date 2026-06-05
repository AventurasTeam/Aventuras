import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

import type { SqlOp, dbSchema } from '@/lib/db'

import type { PipelineActionMap } from './action-map'

export type DeltaSource =
  | 'ai_classifier'
  | 'periodic_classifier'
  | 'user_edit'
  | 'lore_agent'
  | 'chapter_close'

// Db handle accepted by the action layer. Widened so both the proxy (async) and
// expo (sync) drivers satisfy it; the query-builder + .toSQL() surface is uniform.
export type DbCtx = {
  db: BaseSQLiteDatabase<'async' | 'sync', unknown, typeof dbSchema>
  runInTransaction: (ops: SqlOp[]) => Promise<void>
}

export type PipelineAction = {
  [K in keyof PipelineActionMap]: { kind: K } & PipelineActionMap[K]
}[keyof PipelineActionMap]

export type MutationResult =
  | { status: 'ok'; logPosition: number }
  | { status: 'rejected'; reason: string }
