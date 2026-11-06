import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'

import { exportStorySeed } from './seed-export'
import { buildSeedSteps } from '../../lib/db/devtools/seed-dataset'
import { resolveDevSlot } from '../dev-slot/resolve'
import { DATASET_SEED_PATH, seedProviderIds } from '../seed/dataset-story'

// Rewrites the checked-in dataset seed from a database holding its story, after a slice's close
// tasks have run over it:  pnpm dataset:export-seed [db path] [--story <id>]
// The database defaults as pnpm db:seed's does; the story, to the one the seed already holds.
function parseCli(argv: string[]): { dbPath: string; storyId: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { story: { type: 'string' } },
    allowPositionals: true,
  })
  if (positionals.length > 1)
    throw new Error(
      `one database path at most, got ${positionals.length}: ${positionals.join(' ')}`,
    )
  const dbPath =
    positionals[0] ??
    process.env.AVENTURAS_DB_PATH ??
    join(resolveDevSlot().dataDir, 'aventuras.db')
  const storyId = values.story ?? seededStoryId()
  return { dbPath, storyId }
}

function seededStoryId(): string {
  if (!existsSync(DATASET_SEED_PATH))
    throw new Error(`no seed at ${DATASET_SEED_PATH}: pass --story`)
  const seed = JSON.parse(readFileSync(DATASET_SEED_PATH, 'utf8')) as { stories: { id: string }[] }
  return seed.stories[0]!.id
}

async function main() {
  const { dbPath, storyId } = parseCli(process.argv.slice(2))
  if (!existsSync(dbPath)) throw new Error(`no database at ${dbPath}`)
  const sqlite = new DatabaseSync(dbPath, { readOnly: true })
  let json: string
  try {
    json = await exportStorySeed(sqlite, storyId, seedProviderIds(buildSeedSteps()))
  } finally {
    sqlite.close()
  }
  // Beside the target and renamed, so a stop mid-write leaves the last seed whole.
  const draft = `${DATASET_SEED_PATH}.tmp`
  writeFileSync(draft, json)
  renameSync(draft, DATASET_SEED_PATH)
  console.log(`[dataset:export-seed] ${storyId} from ${dbPath} -> ${DATASET_SEED_PATH}`)
}

main().catch((err: unknown) => {
  console.error(`[dataset:export-seed] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
