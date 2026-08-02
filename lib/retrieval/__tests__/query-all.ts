import type { DatabaseSync } from 'node:sqlite'

import type { QueryAll } from '../types'

/**
 * Mirrors both production drivers (electron/db/service.ts → query,
 * lib/db/runtime/exec.native.ts → queryRows): node:sqlite returns row objects,
 * and each is rebuilt into a values-array by key insertion order. Reproducing
 * the Object.values step is the point — a duplicate or numeric column name
 * collapses or reorders the row here exactly as it would in the app.
 */
export const queryAllOf =
  (sqlite: DatabaseSync): QueryAll =>
  async (sql, params) =>
    (sqlite.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]).map((r) =>
      Object.values(r),
    )
