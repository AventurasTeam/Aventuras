import { getTableName } from 'drizzle-orm'

import { listVecFamilyTables } from '../embeddings/vec-tables'
import { db, expoDb } from '../runtime/client.native'
import { dbSchema } from '../schema'
import { buildSeedSteps } from './seed-dataset'

export type ReseedSummary = { tables: number; rows: number }

// Twin of scripts/seed's static rows (the caller then forks br_hero_fork). FKs off: wipe in any
// order; on for the insert, so a broken dataset ref fails loudly. The boot hook already migrated.
export async function reseedDevDatabase(): Promise<ReseedSummary> {
  // Hard floor on the destructive wipe: every app/** route ships in the
  // production bundle, so gating only the Settings entry link isn't enough.
  if (!__DEV__) throw new Error('On-device reseed is a dev-only tool.')

  const steps = buildSeedSteps()
  // Read before either transaction: an await inside one yields to the app, and an app transaction
  // there would end ours under the reseed.
  const vecTables = await listVecFamilyTables(db)

  expoDb.execSync('PRAGMA foreign_keys = OFF;')
  expoDb.execSync('BEGIN;')
  try {
    for (const table of Object.values(dbSchema)) {
      expoDb.execSync(`DELETE FROM "${getTableName(table)}";`)
    }
    // vec0 tables sit outside dbSchema, and the seed carries no vector: a kept one would outlive
    // its rows and collide with the vectors the seed's fork copies.
    for (const table of vecTables) {
      expoDb.execSync(`DELETE FROM "${table}";`)
    }
    expoDb.execSync('COMMIT;')
  } catch (err) {
    expoDb.execSync('ROLLBACK;')
    expoDb.execSync('PRAGMA foreign_keys = ON;')
    throw err
  }
  expoDb.execSync('PRAGMA foreign_keys = ON;')

  expoDb.execSync('BEGIN;')
  try {
    for (const step of steps) {
      if (step.rows.length === 0) continue
      db.insert(step.table)
        .values(step.rows as never)
        .run()
    }
    expoDb.execSync('COMMIT;')
  } catch (err) {
    expoDb.execSync('ROLLBACK;')
    throw err
  }

  return {
    tables: steps.length,
    rows: steps.reduce((n, step) => n + step.rows.length, 0),
  }
}
