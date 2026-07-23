import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
