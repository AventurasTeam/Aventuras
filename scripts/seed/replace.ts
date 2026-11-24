import type { DatabaseSync } from 'node:sqlite'

import { getTableName } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'

import { insertSeedSteps } from './insert'
import type { SeedStep } from '../../lib/db/devtools/seed-dataset'
import { listVecFamilyTables } from '../../lib/db/embeddings/vec-tables'
import { dbSchema } from '../../lib/db/schema'

/**
 * Wipes every table (vector families too) and inserts the steps in one transaction, FKs deferred
 * to commit: the wipe needs no order, a broken reference still fails, any failure keeps old rows.
 */
export async function replaceSeedRows(
  sqlite: DatabaseSync,
  db: SqliteRemoteDatabase<typeof dbSchema>,
  steps: readonly SeedStep[],
): Promise<void> {
  sqlite.exec('BEGIN')
  try {
    sqlite.exec('PRAGMA defer_foreign_keys = ON')
    for (const table of Object.values(dbSchema)) sqlite.exec(`DELETE FROM "${getTableName(table)}"`)
    // vec0 tables sit outside dbSchema, and the seed carries no vector: a kept one would outlive
    // its rows and collide with the vectors the seed's fork copies.
    for (const table of await listVecFamilyTables(db)) sqlite.exec(`DELETE FROM "${table}"`)
    await insertSeedSteps(db, steps)
    sqlite.exec('COMMIT')
  } catch (err) {
    // A deferred-key COMMIT that fails leaves the transaction open.
    sqlite.exec('ROLLBACK')
    throw err
  }
}
