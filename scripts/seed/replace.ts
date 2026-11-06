import type { DatabaseSync } from 'node:sqlite'

import { getTableName } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'

import { insertSeedSteps } from './insert'
import type { SeedStep } from '../../lib/db/devtools/seed-dataset'
import { dbSchema } from '../../lib/db/schema'

/**
 * Wipes every table and inserts the steps in one transaction, foreign keys deferred to the commit:
 * the wipe needs no order, a broken reference still fails, and any failure keeps the old rows.
 */
export async function replaceSeedRows(
  sqlite: DatabaseSync,
  db: SqliteRemoteDatabase<Record<string, unknown>>,
  steps: readonly SeedStep[],
): Promise<void> {
  sqlite.exec('BEGIN')
  try {
    sqlite.exec('PRAGMA defer_foreign_keys = ON')
    for (const table of Object.values(dbSchema)) sqlite.exec(`DELETE FROM "${getTableName(table)}"`)
    await insertSeedSteps(db, steps)
    sqlite.exec('COMMIT')
  } catch (err) {
    // A deferred-key COMMIT that fails leaves the transaction open.
    sqlite.exec('ROLLBACK')
    throw err
  }
}
