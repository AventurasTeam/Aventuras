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

// Before launch: a no-op today (the seed already leaves entities stale), kept
// idempotent for the day it doesn't. After launch it is not: rows an embed pass
// cleared go dirty again with their vectors intact, so the next pass revalidates
// them rather than re-embeds them.
export function markEntitiesEmbeddingStale(dbPath: string, branchId: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare(`UPDATE entities SET embedding_stale = 1 WHERE branch_id = ?`).run(branchId)
  } finally {
    db.close()
  }
}

// Every embeddable table at once. A no-op today for the same reason as
// markEntitiesEmbeddingStale above. Runs before launch.
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

/** Prefix on every id `insertEmbeddableLoreRows` writes, so a spec can count the
 *  rows it handed a turn. Hazard: mnemonic lore ids under a substitutable prefix
 *  — the shape docs/testing.md → Fixture + seed contract exists to prevent —
 *  inert only while no prompt renders a lore id and no such turn completes. */
export const LORE_FILLER_ID_PREFIX = 'e2e_embed_filler_'

// ~2400 chars reaches the default model's 512-token truncation; longer buys no time.
const LORE_FILLER_BODY_CHARS = 2400
const LORE_FILLER_WORDS =
  'veilstone courier ledger sealed parcel bridge ward sigil toll coin bearer tally'.split(' ')

// Rotated at a constant token count: identical composites are the one shape a cache
// down the embed path could serve cheaply, and this fixture exists to be slow.
function loreFillerBody(index: number): string {
  const offset = index % LORE_FILLER_WORDS.length
  const phrase = `${[...LORE_FILLER_WORDS.slice(offset), ...LORE_FILLER_WORDS.slice(0, offset)].join(' ')} `
  return `${phrase.repeat(Math.ceil(LORE_FILLER_BODY_CHARS / phrase.length)).slice(0, LORE_FILLER_BODY_CHARS)} entry ${index}.`
}

/**
 * Append `count` stale lore rows to `branchId`, each body long enough that one
 * 16-text embed chunk costs real inference time. Must run AFTER launch, and only
 * once the story-open drain has settled: seeded before launch, that drain embeds
 * these rows itself, and seeded while it runs, the two race for them. Sound
 * because the app rereads lore per retrieval pass over its own connection.
 */
export function insertEmbeddableLoreRows(dbPath: string, branchId: string, count: number): void {
  const db = new DatabaseSync(dbPath)
  try {
    // The app owns the other connection; wait it out rather than fail mid-write.
    db.exec('PRAGMA busy_timeout = 10000')
    const insert = db.prepare(
      `INSERT INTO lore (id, branch_id, title, body, tags, keywords, injection_mode, priority, embedding_stale, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', '[]', 'auto', 0, 1, 1, 1)`,
    )
    // IMMEDIATE, not deferred: the write lock is taken at BEGIN, so busy_timeout
    // covers the wait for it. A deferred upgrade mid-transaction does not.
    db.exec('BEGIN IMMEDIATE')
    try {
      for (let i = 0; i < count; i++) {
        insert.run(
          `${LORE_FILLER_ID_PREFIX}${i}`,
          branchId,
          `Filler dossier ${i}`,
          loreFillerBody(i),
        )
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
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

function parkWatermark(db: DatabaseSync, branchId: string, processedThrough: number): void {
  db.prepare(
    `UPDATE branches SET classifier_status = json_set(
       COALESCE(classifier_status, '{}'), '$.state', 'idle', '$.retryCount', 0,
       '$.lastSuccessAt', NULL, '$.lastError', NULL, '$.processedThrough', ?)
     WHERE id = ?`,
  ).run(processedThrough, branchId)
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
    parkWatermark(db, branchId, processedThrough)
  } finally {
    db.close()
  }
}

/**
 * Park the classifier watermark at the last `ai_reply` and return that position, so a pass
 * covers only the turns a spec commits after launch — the fixture seeds
 * `classifier_status = NULL`, which floors the window at 0. Anchors on the last reply rather
 * than MAX(position) because the fixture ends on a dangling in-flight turn that boot recovery
 * reverse-replays, putting the seed-time maximum above the tip the app boots with.
 * Runs before launch.
 */
export function parkClassifierWatermarkAtLastReply(dbPath: string, branchId: string): number {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db
      .prepare(
        `SELECT MAX(position) AS p FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'`,
      )
      .get(branchId) as { p: number | null }
    if (row.p === null) {
      throw new Error(`No ai_reply on branch ${branchId}: the watermark would floor at 0.`)
    }
    parkWatermark(db, branchId, row.p)
    return row.p
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

export const CORRUPT_DRAFT_ID = 'e2e_corrupt_draft'

export const LOSSY_DRAFT_ID = 'story_lossy_draft'

// Both draft seeders borrow a definition from whichever story the seed wrote first:
// only the wizard_sessions blob is meant to be unreadable, so the story row itself
// must stay valid. An empty stories table is a broken fixture, not a draft case.
function insertDraftStory(db: DatabaseSync, id: string, title: string): void {
  const donor = db.prepare(`SELECT definition FROM stories LIMIT 1`).get() as
    | { definition: string }
    | undefined
  if (!donor) throw new Error(`cannot seed draft ${id}: the fixture has no story to borrow from`)
  db.prepare(
    `INSERT INTO stories (id, title, description, status, definition, created_at, updated_at)
     VALUES (?, ?, NULL, 'draft', ?, 1, 1)`,
  ).run(id, title, donor.definition)
}

/**
 * A draft whose shell parses but whose lore array holds one unreadable row —
 * unlike `seedCorruptDraft`, this branch keeps its draft pointer, so Save
 * replaces the row those rows are still sitting in. `priority: 150` breaks the
 * schema's 0-100 bound while every other field is fine, the realistic shape.
 */
export function seedLossyDraft(dbPath: string, title: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    insertDraftStory(db, LOSSY_DRAFT_ID, title)
    const state = {
      lore: [
        { id: 'lore_readable', title: 'The Tin Almanac', body: 'Kept.' },
        { id: 'lore_unreadable', title: 'Out of range', priority: 150 },
      ],
    }
    db.prepare(
      `INSERT INTO wizard_sessions (id, story_id, state, updated_at) VALUES (?, ?, ?, 1)`,
    ).run(LOSSY_DRAFT_ID, LOSSY_DRAFT_ID, JSON.stringify(state))
  } finally {
    db.close()
  }
}

// A draft whose wizard_sessions blob fails the shell schema; the definition is
// borrowed so only the blob is unreadable. No app route produces this state.
export function seedCorruptDraft(dbPath: string, title: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    insertDraftStory(db, CORRUPT_DRAFT_ID, title)
    db.prepare(
      `INSERT INTO wizard_sessions (id, story_id, state, updated_at) VALUES (?, ?, ?, 1)`,
    ).run(CORRUPT_DRAFT_ID, CORRUPT_DRAFT_ID, JSON.stringify({ step: 99 }))
  } finally {
    db.close()
  }
}

export const OPENING_ONLY_STORY_ID = 'story_e2e_opening_only'
export const OPENING_ONLY_BRANCH_ID = 'br_e2e_opening_only_main'
export const OPENING_ONLY_TITLE = 'E2E Opening Only'

// Only-opening branch — no seeded fixture has one (every fixture branch has ≥ 2 entries).
// Borrows creative's leadless definition/settings, so no entity rows are needed; the opening
// carries create-story's minimal metadata.
export function seedOpeningOnlyStory(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    const donor = db
      .prepare(`SELECT definition, settings FROM stories WHERE id = 'story_creative'`)
      .get() as { definition: string; settings: string } | undefined
    if (!donor) {
      throw new Error(
        'cannot seed the opening-only story: story_creative is missing from the fixture',
      )
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(
        `INSERT INTO stories (id, title, description, status, definition, settings, created_at, updated_at, current_branch_id)
         VALUES (?, ?, NULL, 'active', ?, ?, 1, 1, ?)`,
      ).run(
        OPENING_ONLY_STORY_ID,
        OPENING_ONLY_TITLE,
        donor.definition,
        donor.settings,
        OPENING_ONLY_BRANCH_ID,
      )
      db.prepare(
        `INSERT INTO branches (id, story_id, name, created_at) VALUES (?, ?, 'main', 1)`,
      ).run(OPENING_ONLY_BRANCH_ID, OPENING_ONLY_STORY_ID)
      db.prepare(
        `INSERT INTO story_entries (id, branch_id, position, kind, content, metadata, created_at)
         VALUES ('entry_e2e_opening', ?, 1, 'opening', ?, ?, 1)`,
      ).run(
        OPENING_ONLY_BRANCH_ID,
        'The tide has gone out and left the parish standing. Nobody has written back yet.',
        JSON.stringify({ sceneEntities: [], currentLocationId: null, worldTime: 0 }),
      )
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    db.close()
  }
}

// `providers` must be an array — an object hits hydrateAppSettings' parse-failure arm, gating
// app/_layout on SettingsRecoveryScreen. Missing rows / bad `diagnostics` blobs don't reach it,
// and no app route writes this state.
export function corruptAppSettings(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    const { changes } = db
      .prepare(`UPDATE app_settings SET providers = ? WHERE id = 'singleton'`)
      .run(JSON.stringify({ not: 'an array' }))
    // A zero-row UPDATE would leave the fixture healthy, and the spec that
    // depends on this would boot fine and assert nothing.
    if (changes !== 1) {
      throw new Error(`cannot corrupt app_settings: expected 1 row, updated ${changes}`)
    }
  } finally {
    db.close()
  }
}
