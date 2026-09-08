import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORY_SETTINGS_DEFAULTS } from '@/lib/db'

const MIGRATIONS_DIR = 'lib/db/migrations'
const TAG = '0013_classifier_context_entries'

function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag)
}

function applyMigration(sqlite: DatabaseSync, tag: string): void {
  const sql = readFileSync(`${MIGRATIONS_DIR}/${tag}.sql`, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) sqlite.exec(trimmed)
  }
}

// No classifierContextEntries key, plus enough siblings to prove the migration writes one key.
const LEGACY_SETTINGS = {
  chapterTokenThreshold: 24000,
  classifierCadence: 5,
  piggybackMode: 'off',
  retrievalBudgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
  keywordRetrieval: {
    mode: 'boost',
    budgetShare: 0.5,
    scanEntries: 1,
    cascade: false,
    cascadeMaxDepth: 2,
  },
  embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
  packVariables: { tone: 'wry' },
}

function settingsOf(db: DatabaseSync, storyId: string): Record<string, unknown> | null {
  const row = db.prepare('select settings from stories where id = ?').get(storyId) as
    | { settings: string | null }
    | undefined
  return row?.settings == null ? null : (JSON.parse(row.settings) as Record<string, unknown>)
}

function insertStory(db: DatabaseSync, id: string, settings: unknown): void {
  db.prepare(
    'insert into stories (id, title, settings, created_at, updated_at) values (?,?,?,?,?)',
  ).run(id, id, settings === null ? null : JSON.stringify(settings), 1, 1)
}

describe(TAG, () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:', { allowExtension: true })
    db.loadExtension(getLoadablePath())
    for (const tag of migrationTags()) {
      if (tag === TAG) break
      applyMigration(db, tag)
    }
  })

  // drizzle-orm looks migrations up by key (m0013), not by filename. Both halves
  // must be present; an import-only file would boot crash on the missing key.
  it('is wired into the upgrade path, not just present on disk', () => {
    expect(migrationTags()).toContain(TAG)
    const runtime = readFileSync(`${MIGRATIONS_DIR}/migrations.js`, 'utf8')
    expect(runtime).toContain(`${TAG}.sql`)
    const runtimeKey = `m${TAG.slice(0, 4)}`
    expect(runtime).toMatch(new RegExp(`^\\s*${runtimeKey},\\s*$`, 'm'))
  })

  it('creates the key on a settings blob that predates it', () => {
    insertStory(db, 's1', LEGACY_SETTINGS)
    expect(settingsOf(db, 's1')?.classifierContextEntries).toBeUndefined()

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')?.classifierContextEntries).toBe(
      STORY_SETTINGS_DEFAULTS.classifierContextEntries,
    )
  })

  it('leaves every sibling settings key untouched', () => {
    insertStory(db, 's1', LEGACY_SETTINGS)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toEqual({
      ...LEGACY_SETTINGS,
      classifierContextEntries: STORY_SETTINGS_DEFAULTS.classifierContextEntries,
    })
  })

  // A user-chosen depth must survive a re-run, so the statement is idempotent.
  it('leaves a story that already carries the key alone', () => {
    insertStory(db, 's1', { ...LEGACY_SETTINGS, classifierContextEntries: 9 })

    applyMigration(db, TAG)
    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')?.classifierContextEntries).toBe(9)
  })

  // Deliberate — the key is z.number(), so a stored null fails story open as
  // settings-corrupt; json_extract IS NULL matches it and the backfill repairs it.
  it('repairs an explicit null rather than preserving it', () => {
    insertStory(db, 's1', { ...LEGACY_SETTINGS, classifierContextEntries: null })

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')?.classifierContextEntries).toBe(
      STORY_SETTINGS_DEFAULTS.classifierContextEntries,
    )
  })

  // json_set raises on non-JSON text and aborts the whole UPDATE: without the guard one
  // unparseable blob leaves every other story unmigrated and the app unable to boot.
  it.each([
    ['unparseable text', '{not json'],
    ['an empty string', ''],
    ['a top-level array', '[1,2]'],
    ['a top-level scalar', '42'],
  ])('migrates good rows beside %s', (_label, raw) => {
    insertStory(db, 's_good', LEGACY_SETTINGS)
    db.prepare(
      'insert into stories (id, title, settings, created_at, updated_at) values (?,?,?,?,?)',
    ).run('s_bad', 's_bad', raw, 1, 1)

    expect(() => applyMigration(db, TAG)).not.toThrow()

    expect(settingsOf(db, 's_good')?.classifierContextEntries).toBe(
      STORY_SETTINGS_DEFAULTS.classifierContextEntries,
    )
    const bad = db.prepare('select settings from stories where id = ?').get('s_bad') as {
      settings: string
    }
    expect(bad.settings).toBe(raw)
  })

  // json_valid alone admits these, and json_set would rewrite the column
  // re-serialized. The array's spacing is the assertion; the scalar is parity.
  it.each([
    ['a spaced top-level array', '[1, 2]'],
    ['a quoted scalar', '"already gone"'],
  ])('does not rewrite %s', (_label, raw) => {
    db.prepare(
      'insert into stories (id, title, settings, created_at, updated_at) values (?,?,?,?,?)',
    ).run('s_odd', 's_odd', raw, 1, 1)

    applyMigration(db, TAG)

    const after = db.prepare('select settings from stories where id = ?').get('s_odd') as {
      settings: string
    }
    expect(after.settings).toBe(raw)
  })

  it('leaves a wizard draft with no settings blob null rather than writing one', () => {
    insertStory(db, 's1', null)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toBeNull()
  })
})
