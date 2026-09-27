import { join } from 'node:path'

import { defineConfig } from 'drizzle-kit'

import { slotDataDir } from './scripts/dev-slot/slot'

// The main config keeps driver:'expo' (required by db:generate), which the
// studio command rejects — so desktop DB browsing lives here, pointed at the
// Electron on-disk file. Default is the dev app's userData dir; override with
// AVENTURAS_DB_PATH for a worker slot or the production DB.
const dbPath = process.env.AVENTURAS_DB_PATH ?? join(slotDataDir(0), 'aventuras.db')

export default defineConfig({
  dialect: 'sqlite',
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dbCredentials: { url: dbPath },
})
