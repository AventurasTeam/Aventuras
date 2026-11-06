import { getTableColumns } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'

import { chunked, rowsPerInsert } from '../../lib/db/bind-limit'
import type { SeedStep } from '../../lib/db/devtools/seed-dataset'

/** Inserts each step in order, split so no statement binds past SQLite's cap. */
export async function insertSeedSteps(
  db: SqliteRemoteDatabase<Record<string, unknown>>,
  steps: readonly SeedStep[],
): Promise<void> {
  for (const s of steps) {
    const perInsert = rowsPerInsert(Object.keys(getTableColumns(s.table)).length)
    for (const rows of chunked(s.rows, perInsert)) await db.insert(s.table).values(rows as never)
  }
}
