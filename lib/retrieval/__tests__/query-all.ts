import type { DatabaseSync } from 'node:sqlite'

import type { QueryAll } from '../types'

/**
 * Android's `queryRows` (lib/db/runtime/exec.native.ts): expo-sqlite hands back row OBJECTS,
 * rebuilt into values-arrays by key insertion order, so a duplicate or numeric column name
 * collapses or reorders the row as it would there. Desktop reads arrays and keeps such a row whole.
 */
export const queryAllOf =
  (sqlite: DatabaseSync): QueryAll =>
  async (sql, params) =>
    (sqlite.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]).map((r) =>
      Object.values(r),
    )
