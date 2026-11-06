import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'

import { getTableName } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { getLoadablePath } from 'sqlite-vec'

import { datasetStorySteps, seedAppRefs } from './dataset-story'
import { insertSeedSteps } from './insert'
import { buildLongBranchSteps, entryIdAt, LONG_BRANCH_SCALES, longBranchId } from './long-branch'
import { makeProxy } from './sqlite-proxy'
import { buildSeedSteps, type SeedStep } from '../../lib/db/devtools/seed-dataset'
import { dbSchema } from '../../lib/db/schema'
import { resolveDevSlot } from '../dev-slot/resolve'
import { slotPorts } from '../dev-slot/slot'

// Strict: an ignored typo would seed something other than what was asked for.
function parseCli(argv: string[]): {
  path: string | undefined
  longBranch: boolean
  dataset: boolean
} {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      'long-branch': { type: 'boolean', default: false },
      dataset: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  if (positionals.length > 1) {
    throw new Error(
      `one database path at most, got ${positionals.length}: ${positionals.join(' ')}`,
    )
  }
  return { path: positionals[0], longBranch: values['long-branch'], dataset: values.dataset }
}

let cli: ReturnType<typeof parseCli>
try {
  cli = parseCli(process.argv.slice(2))
} catch (err) {
  console.error(`[seed] ${err instanceof Error ? err.message : String(err)}`)
  console.error(
    '[seed] usage: pnpm db:seed [db path], pnpm db:seed:long [db path], or pnpm db:seed:dataset [db path]',
  )
  process.exit(1)
}

// Default is the dev slot's userData DB — slot 0 is the one drizzle.studio.config.ts browses.
// Override with AVENTURAS_DB_PATH or a positional arg.
function resolveTarget(): { dbPath: string; mockPort?: number } {
  if (cli.path) return { dbPath: cli.path }
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
  if (cli.longBranch) steps.push(...LONG_BRANCH_SCALES.flatMap(buildLongBranchSteps))
  const dataset = cli.dataset ? datasetStorySteps(seedAppRefs(steps)) : []
  steps.push(...dataset)
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
    await insertSeedSteps(db, steps)
    sqlite.exec('COMMIT')
  } catch (err) {
    sqlite.exec('ROLLBACK')
    throw err
  }

  const rowsByTable = new Map<string, number>()
  for (const s of steps) rowsByTable.set(s.name, (rowsByTable.get(s.name) ?? 0) + s.rows.length)
  for (const [name, count] of rowsByTable) console.log(`[seed]   ${name}: ${count}`)
  const total = steps.reduce((n, s) => n + s.rows.length, 0)
  console.log(`[seed] done — ${total} rows across ${rowsByTable.size} tables.`)
  if (cli.longBranch) {
    for (const chapters of LONG_BRANCH_SCALES) {
      console.log(`[seed] ${longBranchId(chapters)}: first entry ${entryIdAt(chapters, 1)}`)
    }
  }
  for (const branch of dataset.find((s) => s.name === 'branches')?.rows ?? [])
    console.log(`[seed] dataset branch: ${(branch as { id: string }).id}`)
}

main().catch((err) => {
  console.error('[seed] FAILED:', err)
  process.exitCode = 1
})
