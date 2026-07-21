import { DatabaseSync } from 'node:sqlite'

import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { getLoadablePath } from 'sqlite-vec'

import { dbSchema } from '../schema'

// drizzle-orm 0.45.2 ships no node-sqlite driver; sqlite-proxy wraps any
// SQLite backend via a callback, making node:sqlite usable without a native dep.
// The proxy's mapResultRow indexes rows by column position, so all methods
// must return rows as arrays-of-values, not as objects. Mirrors the desktop
// (Electron main) adapter: 'get' returns the single row directly so drizzle
// decodes it as a row rather than an array-of-rows.
function makeCallback(sqlite: DatabaseSync) {
  return async (
    sql: string,
    params: unknown[],
    method: 'run' | 'all' | 'get' | 'values',
  ): Promise<{ rows: unknown[] }> => {
    const stmt = sqlite.prepare(sql)
    if (method === 'run') {
      stmt.run(...(params as Parameters<typeof stmt.run>))
      return { rows: [] }
    }
    const raw = stmt.all(...(params as Parameters<typeof stmt.all>)) as Record<string, unknown>[]
    const asArrays = raw.map((r) => Object.values(r))
    return { rows: (method === 'get' ? asArrays[0] : asArrays) as unknown[] }
  }
}

// Returns a fresh in-memory db with the committed migration folder applied.
// Async because sqlite-proxy/migrator awaits the proxy callback internally.
// Mirrors the desktop (Electron main) runtime: node:sqlite with FK enforcement.
export async function createTestDb() {
  const sqlite = new DatabaseSync(':memory:', { allowExtension: true })
  sqlite.loadExtension(getLoadablePath())
  sqlite.exec('PRAGMA foreign_keys = ON;')
  const callback = makeCallback(sqlite)
  const db = drizzle(callback, { schema: dbSchema })
  await migrate(db, (queries) => Promise.resolve(queries.forEach((q) => sqlite.exec(q))), {
    migrationsFolder: 'lib/db/migrations',
  })
  const runInTransaction = async (ops: { sql: string; params: unknown[] }[]): Promise<void> => {
    try {
      sqlite.exec('BEGIN')
      for (const op of ops) sqlite.prepare(op.sql).run(...(op.params as never[]))
      sqlite.exec('COMMIT')
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK')
      } catch {
        // BEGIN itself failed — no transaction to roll back; surface the original error.
      }
      throw err
    }
  }
  return { db, sqlite, runInTransaction }
}
