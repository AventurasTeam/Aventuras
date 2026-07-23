import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const REPO_ROOT = join(__dirname, '..', '..')

// Build a throwaway Electron userData dir seeded with the dev fixture. The DB
// lands at <dir>/aventuras.db — exactly where getDbFilePath() resolves under
// --user-data-dir — so a launched app opens it with zero product changes.
// Reuses scripts/seed (migrations + Zod-validated dataset) rather than
// duplicating the seed path. Per-worker isolation comes for free: each call
// mints its own temp dir. See docs/testing.md → Fixture + seed contract.
export function createSeededUserDataDir(): { userDataDir: string; dbPath: string } {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aventuras-e2e-'))
  const dbPath = join(userDataDir, 'aventuras.db')
  execFileSync('pnpm', ['db:seed', dbPath], { cwd: REPO_ROOT, stdio: 'pipe' })
  return { userDataDir, dbPath }
}

// Repoint every openai-compatible provider at the mock server. Runs before
// launch, so the app reads the mock URL into its settings store on boot.
export function setProviderEndpoint(dbPath: string, url: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`SELECT providers FROM app_settings WHERE id = 'singleton'`).get() as {
      providers: string
    }
    const providers = JSON.parse(row.providers) as { type: string; endpoint?: string }[]
    for (const provider of providers) {
      if (provider.type === 'openai-compatible') provider.endpoint = url
    }
    db.prepare(`UPDATE app_settings SET providers = ? WHERE id = 'singleton'`).run(
      JSON.stringify(providers),
    )
  } finally {
    db.close()
  }
}

// Clear taggedBlockReliable on every cached model so piggyback can't ride
// in-band — forcing the per-turn fallback classifier (a separate structured
// call) to fire. Runs before launch.
export function disablePiggybackCapability(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`SELECT providers FROM app_settings WHERE id = 'singleton'`).get() as {
      providers: string
    }
    const providers = JSON.parse(row.providers) as {
      cachedModels?: { capabilities?: Record<string, unknown> }[]
    }[]
    for (const provider of providers) {
      for (const model of provider.cachedModels ?? []) {
        if (model.capabilities) delete model.capabilities.taggedBlockReliable
      }
    }
    db.prepare(`UPDATE app_settings SET providers = ? WHERE id = 'singleton'`).run(
      JSON.stringify(providers),
    )
  } finally {
    db.close()
  }
}
