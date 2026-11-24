import { join } from 'node:path'

import { parseCli } from './cli'
import { seedDatabase } from './run'
import { resolveDevSlot } from '../dev-slot/resolve'

let cli: ReturnType<typeof parseCli>
try {
  cli = parseCli(process.argv.slice(2))
} catch (err) {
  console.error(`[seed] ${err instanceof Error ? err.message : String(err)}`)
  console.error(
    '[seed] usage: pnpm db:seed [db path], pnpm db:seed:long [db path], or pnpm db:seed:dataset [--overlay] [db path]',
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

async function main() {
  const { dbPath, mockPort } = resolveTarget()
  await seedDatabase(dbPath, cli, mockPort)
}

main().catch((err) => {
  console.error('[seed] FAILED:', err)
  process.exitCode = 1
})
