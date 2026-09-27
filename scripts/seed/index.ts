import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { getTableName } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { getLoadablePath } from 'sqlite-vec'

import { buildSeedSteps, type SeedStep } from '../../lib/db/devtools/seed-dataset'
import { dbSchema } from '../../lib/db/schema'
import { resolveDevSlot } from '../dev-slot/resolve'
import { slotPorts } from '../dev-slot/slot'

// Default is the dev slot's userData DB — slot 0 mirrors drizzle.studio.config.ts, the Linux
// Electron dev DB. Override with AVENTURAS_DB_PATH or a positional arg for another OS / file.
function resolveTarget(): { dbPath: string; mockPort?: number } {
  const arg = process.argv[2]
  if (arg && !arg.startsWith('-')) return { dbPath: arg }
  if (process.env.AVENTURAS_DB_PATH) return { dbPath: process.env.AVENTURAS_DB_PATH }
  const { slot, dataDir, ports } = resolveDevSlot()
  return { dbPath: join(dataDir, 'aventuras.db'), mockPort: slot === 0 ? undefined : ports.mock }
}

// The dataset's provider points at the slot-0 mock; a worker slot runs its own.
function repointSeedProvider(steps: SeedStep[], port: number): void {
  const seeded = `http://localhost:${slotPorts(0).mock}/v1`
  for (const step of steps) {
    if (getTableName(step.table) !== 'app_settings') continue
    for (const row of step.rows as { providers?: { endpoint?: string }[] }[]) {
      for (const provider of row.providers ?? []) {
        if (provider.endpoint === seeded) provider.endpoint = `http://localhost:${port}/v1`
      }
    }
  }
}

// node:sqlite returns row objects; sqlite-proxy needs positional arrays. 'get'
// returns the single row directly. Identical to electron/db/service.ts.
function makeProxy(sqlite: DatabaseSync) {
  return async (sql: string, params: unknown[], method: 'run' | 'all' | 'get' | 'values') => {
    const stmt = sqlite.prepare(sql)
    if (method === 'run') {
      stmt.run(...(params as never[]))
      return { rows: [] }
    }
    const raw = stmt.all(...(params as never[])) as Record<string, unknown>[]
    const asArrays = raw.map((r) => Object.values(r))
    return { rows: (method === 'get' ? asArrays[0] : asArrays) as unknown[] }
  }
}

async function main() {
  const { dbPath, mockPort } = resolveTarget()
  mkdirSync(dirname(dbPath), { recursive: true })
  console.log(`[seed] target DB: ${dbPath}`)

  const sqlite = new DatabaseSync(dbPath, { allowExtension: true })
  try {
    sqlite.enableLoadExtension(true)
    sqlite.loadExtension(getLoadablePath())
  } catch (err) {
    // Non-fatal here — migrate() below will throw its own error if a vec0
    // statement actually needs the extension and it failed to load.
    console.warn('[seed] sqlite-vec load skipped:', (err as Error).message)
  } finally {
    sqlite.enableLoadExtension(false) // re-close the surface after loading
  }
  sqlite.exec('PRAGMA foreign_keys = ON;')

  const db = drizzle(makeProxy(sqlite), { schema: dbSchema })
  await migrate(db, (queries) => Promise.resolve(queries.forEach((q) => sqlite.exec(q))), {
    migrationsFolder: 'lib/db/migrations',
  })

  const steps = buildSeedSteps()
  if (mockPort !== undefined) {
    repointSeedProvider(steps, mockPort)
    console.log(`[seed] provider endpoint: http://localhost:${mockPort}/v1`)
  }

  // Wipe with FKs off (order-independent), then insert with FKs on so any broken
  // reference in the dataset surfaces as an error rather than landing silently.
  console.log('[seed] wiping existing rows…')
  sqlite.exec('PRAGMA foreign_keys = OFF;')
  sqlite.exec('BEGIN')
  for (const table of Object.values(dbSchema)) sqlite.exec(`DELETE FROM "${getTableName(table)}";`)
  sqlite.exec('COMMIT')
  sqlite.exec('PRAGMA foreign_keys = ON;')

  sqlite.exec('BEGIN')
  try {
    for (const s of steps) {
      if (s.rows.length === 0) continue
      await db.insert(s.table).values(s.rows as never)
    }
    sqlite.exec('COMMIT')
  } catch (err) {
    sqlite.exec('ROLLBACK')
    throw err
  }

  const total = steps.reduce((n, s) => n + s.rows.length, 0)
  for (const s of steps) console.log(`[seed]   ${s.name}: ${s.rows.length}`)
  console.log(`[seed] done — ${total} rows across ${steps.length} tables.`)
}

main().catch((err) => {
  console.error('[seed] FAILED:', err)
  process.exitCode = 1
})
