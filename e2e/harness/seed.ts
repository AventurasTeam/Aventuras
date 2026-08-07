import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const REPO_ROOT = join(__dirname, '..', '..')

// Remove a seeded temp dir; safe to call more than once (launchApp also removes
// it on close). Specs call it in afterAll so a setup failure between seed and
// launch doesn't orphan the dir.
export function removeUserDataDir(dir: string | undefined): void {
  if (dir) rmSync(dir, { recursive: true, force: true })
}

// Build a throwaway Electron userData dir seeded with the dev fixture. The DB
// lands at <dir>/aventuras.db — exactly where getDbFilePath() resolves under
// --user-data-dir — so a launched app opens it with zero product changes.
// Reuses scripts/seed (migrations + Zod-validated dataset) rather than
// duplicating the seed path. Per-worker isolation comes for free: each call
// mints its own temp dir. See docs/testing.md → Fixture + seed contract.
export function createSeededUserDataDir(): { userDataDir: string; dbPath: string } {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aventuras-e2e-'))
  const dbPath = join(userDataDir, 'aventuras.db')
  try {
    execFileSync('pnpm', ['db:seed', dbPath], { cwd: REPO_ROOT, stdio: 'pipe' })
  } catch (err) {
    // Don't orphan the dir if seeding fails after mkdtemp.
    removeUserDataDir(userDataDir)
    throw err
  }
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

// Turn the diagnostics gate on. Off in the defaults, and the Actions menu drops
// capability-gated entries rather than disabling them, so the Diagnostics Hub
// row — the only route jump that menu owns — is absent without this.
export function enableDiagnostics(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`SELECT diagnostics FROM app_settings WHERE id = 'singleton'`).get() as {
      diagnostics: string
    }
    const diagnostics = JSON.parse(row.diagnostics) as Record<string, boolean>
    diagnostics.enabled = true
    db.prepare(`UPDATE app_settings SET diagnostics = ? WHERE id = 'singleton'`).run(
      JSON.stringify(diagnostics),
    )
  } finally {
    db.close()
  }
}

// Set a profile's structuredOutput mode (auto | force-on | force-off). force-on
// routes structured calls through native response_format instead of the
// prompt-injected schema. Runs before launch.
export function setProfileStructuredOutput(
  dbPath: string,
  profileId: string,
  mode: 'auto' | 'force-on' | 'force-off',
): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`SELECT profiles FROM app_settings WHERE id = 'singleton'`).get() as {
      profiles: string
    }
    const profiles = JSON.parse(row.profiles) as { id: string; structuredOutput?: string }[]
    for (const profile of profiles) {
      if (profile.id === profileId) profile.structuredOutput = mode
    }
    db.prepare(`UPDATE app_settings SET profiles = ? WHERE id = 'singleton'`).run(
      JSON.stringify(profiles),
    )
  } finally {
    db.close()
  }
}

// The seed marks one lore row and one chapter row stale and no entity, so a
// spec that needs entities_vec_* populated by a drain has to flip them itself.
// Runs before launch.
export function markEntitiesEmbeddingStale(dbPath: string, branchId: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare(`UPDATE entities SET embedding_stale = 1 WHERE branch_id = ?`).run(branchId)
  } finally {
    db.close()
  }
}

// Every embeddable table at once. The seed leaves happenings, threads and
// entities fresh, so their vec0 families stay empty and KNN returns nothing —
// a retrieval spec that needs a ranked bundle has to give the embed path
// something to embed. Runs before launch.
const EMBEDDABLE_TABLES = ['entities', 'lore', 'chapters', 'threads', 'happenings'] as const

export function markBranchEmbeddingStale(dbPath: string, branchId: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    for (const table of EMBEDDABLE_TABLES) {
      db.prepare(`UPDATE "${table}" SET embedding_stale = 1 WHERE branch_id = ?`).run(branchId)
    }
  } finally {
    db.close()
  }
}

// Leave a story mid-swap: the marker is exactly what a crash mid-phase-1 leaves
// behind, and the state the swap-paused pill exists to surface. Runs before launch.
export function markSwapPending(dbPath: string, storyId: string, targetModelId: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare(`UPDATE stories SET settings = json_patch(settings, json(?)) WHERE id = ?`).run(
      JSON.stringify({ embedding_swap_target: targetModelId }),
      storyId,
    )
  } finally {
    db.close()
  }
}

// Force the classifier to fire on the next committed turn. Runs before launch.
export function setClassifierCadence(dbPath: string, storyId: string, cadence: number): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`SELECT settings FROM stories WHERE id = ?`).get(storyId) as {
      settings: string
    }
    const settings = JSON.parse(row.settings) as Record<string, unknown>
    settings.classifierCadence = cadence
    db.prepare(`UPDATE stories SET settings = ? WHERE id = ?`).run(
      JSON.stringify(settings),
      storyId,
    )
  } finally {
    db.close()
  }
}

/**
 * Append `count` filler turns and park the classifier watermark at `processedThrough`,
 * so the branch carries a backlog deeper than the reader's entry window. Each filler
 * body embeds its position, so a spec can tell which turns a pass actually read.
 * Runs before launch.
 */
export function seedClassifierBacklog(
  dbPath: string,
  branchId: string,
  count: number,
  processedThrough: number,
): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db
      .prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM story_entries WHERE branch_id = ?`)
      .get(branchId) as { p: number }
    const insert = db.prepare(
      `INSERT INTO story_entries (id, branch_id, position, kind, content, chapter_id, metadata, created_at)
       VALUES (?, ?, ?, 'ai_reply', ?, NULL, '{}', 1)`,
    )
    for (let i = 1; i <= count; i++) {
      const position = row.p + i
      insert.run(
        `e2e_filler_${position}`,
        branchId,
        position,
        `FILLER-${position} nothing happens.`,
      )
    }
    db.prepare(
      `UPDATE branches SET classifier_status = json_set(
         COALESCE(classifier_status, '{}'), '$.state', 'idle', '$.retryCount', 0,
         '$.lastSuccessAt', NULL, '$.lastError', NULL, '$.processedThrough', ?)
       WHERE id = ?`,
    ).run(processedThrough, branchId)
  } finally {
    db.close()
  }
}

/** Strip the `classifier` agent assignment so the pass fails pre-flight. Runs before launch. */
export function unassignClassifierAgent(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`SELECT assignments FROM app_settings WHERE id = 'singleton'`).get() as {
      assignments: string
    }
    const assignments = JSON.parse(row.assignments) as Record<string, unknown>
    delete assignments.classifier
    db.prepare(`UPDATE app_settings SET assignments = ? WHERE id = 'singleton'`).run(
      JSON.stringify(assignments),
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
