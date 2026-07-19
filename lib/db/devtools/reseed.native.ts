import { getTableName } from 'drizzle-orm'

import { db, expoDb } from '../runtime/client.native'
import { dbSchema } from '../schema'
import { buildSeedSteps } from './seed-dataset'

export type ReseedSummary = { tables: number; rows: number }

// On-device twin of scripts/seed/index.ts: wipe with FKs off
// (order-independent), insert with FKs on so a broken reference in the
// dataset fails loudly. Migrations are not run here — the boot hook already
// migrated the live connection.
export async function reseedDevDatabase(): Promise<ReseedSummary> {
  const steps = buildSeedSteps()

  expoDb.execSync('PRAGMA foreign_keys = OFF;')
  expoDb.execSync('BEGIN;')
  try {
    for (const table of Object.values(dbSchema)) {
      expoDb.execSync(`DELETE FROM "${getTableName(table)}";`)
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
      await db.insert(step.table).values(step.rows as never)
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
