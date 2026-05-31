import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { app } from 'electron'
import { getLoadablePath } from 'sqlite-vec'

import type { DbProxyMethod, DbProxyResult } from './types'

let sqlite: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (!sqlite) throw new Error('DB not initialized — call initDb() first.')
  return sqlite
}

function resolveMigrationsDir(): string {
  // Dev: electron/dist/db/service.js -> repo root. Packaged: bundled under resources.
  return app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(__dirname, '..', '..', '..', 'lib', 'db', 'migrations')
}

// node:sqlite returns row objects; sqlite-proxy needs positional arrays. For
// 'get', drizzle treats the returned rows value AS the single row, so it must be
// that one positional array (or undefined when no row matched — returning [] here
// makes drizzle map an empty row and emit a bogus object / decoder error).
export function query(sqlText: string, params: unknown[], method: DbProxyMethod): DbProxyResult {
  const stmt = getDb().prepare(sqlText)
  if (method === 'run') {
    stmt.run(...(params as never[]))
    return { rows: [] }
  }
  const rows = stmt.all(...(params as never[])) as Record<string, unknown>[]
  const asArrays = rows.map((r) => Object.values(r))
  return { rows: (method === 'get' ? asArrays[0] : asArrays) as unknown[] }
}

export function exec(sqlText: string): void {
  getDb().exec(sqlText)
}

// Single-RPC atomic transaction — the contract the 1.5 action layer uses on
// desktop (sqlite-proxy has no interactive transaction support).
export function transaction(ops: { sql: string; params: unknown[] }[]): { ok: true } {
  const db = getDb()
  try {
    db.exec('BEGIN')
    for (const op of ops) db.prepare(op.sql).run(...(op.params as never[]))
    db.exec('COMMIT')
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // BEGIN itself failed — no transaction to roll back; surface the original error.
    }
    throw e
  }
  return { ok: true }
}

export function getDbFilePath(): string {
  return join(app.getPath('userData'), 'aventuras.db')
}

export async function initDb(): Promise<void> {
  const file = getDbFilePath()
  sqlite = new DatabaseSync(file, { allowExtension: true })
  sqlite.enableLoadExtension(true)
  sqlite.loadExtension(getLoadablePath())
  sqlite.enableLoadExtension(false) // re-close the surface after loading
  sqlite.exec('PRAGMA foreign_keys = ON;')
  // drizzle-orm 0.45.2 has no node-sqlite migrator; run migrations through the
  // sqlite-proxy migrator backed by this node:sqlite connection.
  const proxyDb = drizzle(async (s, p, m) => query(s, p, m as DbProxyMethod))
  await migrate(proxyDb, (queries) => Promise.resolve(queries.forEach((q) => getDb().exec(q))), {
    migrationsFolder: resolveMigrationsDir(),
  })
}
