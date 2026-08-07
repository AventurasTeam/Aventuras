import type { DatabaseSync } from 'node:sqlite'

import type { QueryAll } from '../types'

/**
 * node:sqlite is the desktop driver only (electron/db/service.ts → query);
 * native goes through expo-sqlite (lib/db/runtime/exec.native.ts → queryRows).
 * Both hand back row OBJECTS and rebuild each into a values-array by key
 * insertion order, which is the step reproduced here — a duplicate or numeric
 * column name collapses or reorders the row exactly as it would in the app.
 */
export const queryAllOf =
  (sqlite: DatabaseSync): QueryAll =>
  async (sql, params) =>
    (sqlite.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]).map((r) =>
      Object.values(r),
    )
