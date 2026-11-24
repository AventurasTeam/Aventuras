import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { getTableName } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { getLoadablePath } from 'sqlite-vec'

import type { parseCli } from './cli'
import { datasetStorySteps, seedAppRefs } from './dataset-story'
import { buildLongBranchSteps, entryIdAt, LONG_BRANCH_SCALES, longBranchId } from './long-branch'
import { replaceSeedRows } from './replace'
import { makeProxy } from './sqlite-proxy'
import { buildSeedSteps, HERO_FORK, type SeedStep } from '../../lib/db/devtools/seed-dataset'
import { dbSchema } from '../../lib/db/schema'
import { slotPorts } from '../dev-slot/slot'

// The path is seedDatabase's own argument: a second copy here could name another file.
type SeedModes = Omit<ReturnType<typeof parseCli>, 'path'>

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

async function writeSeedRows(
  sqlite: DatabaseSync,
  cli: SeedModes,
  mockPort: number | undefined,
): Promise<void> {
  try {
    sqlite.enableLoadExtension(true)
    sqlite.loadExtension(getLoadablePath())
  } catch (err) {
    // Non-fatal: a vec0 statement below, in migrate() or the wipe, fails on its own without it.
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

  console.log('[seed] replacing every row…')
  await replaceSeedRows(sqlite, db, steps)

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

// C7: every mode holds the hero story, so every mode forks it through the reader's fork core.
async function applyHeroFork(dbPath: string): Promise<void> {
  const [{ registerAllDomains, seedHeroFork }, { openTestDb }] = await Promise.all([
    import('../../lib/actions'),
    import('../../lib/db/__tests__/test-db'),
  ])
  const opened = await openTestDb(dbPath)
  try {
    registerAllDomains()
    await seedHeroFork({ db: opened.db, runInTransaction: opened.runInTransaction })
  } finally {
    opened.sqlite.close()
  }
  console.log(
    `[seed] ${HERO_FORK.id}: forked from ${HERO_FORK.parentId} at ${HERO_FORK.forkEntryId}`,
  )
}

// Only with --overlay: the dataset story's test overlay, through the action layer.
async function applyOverlay(dbPath: string): Promise<void> {
  const [{ registerAllDomains }, { openTestDb }, { applyDatasetOverlay }] = await Promise.all([
    import('../../lib/actions'),
    import('../../lib/db/__tests__/test-db'),
    import('../dataset-chapter/overlay'),
  ])
  const opened = await openTestDb(dbPath)
  try {
    registerAllDomains()
    const outcome = await applyDatasetOverlay({
      db: opened.db,
      runInTransaction: opened.runInTransaction,
    })
    console.log(
      `[seed] dataset overlay applied: chapter ${outcome.reopened ? 'reopened' : 'already open'}, user edit ${outcome.userEdit}`,
    )
  } finally {
    opened.sqlite.close()
  }
}

/** `pnpm db:seed` on `dbPath`; a worker slot passes its mock's port for the seeded provider. */
export async function seedDatabase(
  dbPath: string,
  cli: SeedModes,
  mockPort?: number,
): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true })
  console.log(`[seed] target DB: ${dbPath}`)

  const sqlite = new DatabaseSync(dbPath, { allowExtension: true })
  try {
    await writeSeedRows(sqlite, cli, mockPort)
  } finally {
    // The fork and the overlay open the file again, through the action layer.
    sqlite.close()
  }
  await applyHeroFork(dbPath)
  if (cli.overlay) await applyOverlay(dbPath)
}
