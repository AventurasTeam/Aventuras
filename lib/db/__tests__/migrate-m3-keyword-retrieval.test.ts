import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORY_SETTINGS_DEFAULTS } from '@/lib/db'

const MIGRATIONS_DIR = 'lib/db/migrations'
const TAG = '0011_keyword_retrieval_settings'

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

// No keywordRetrieval key, plus enough siblings to prove the migration writes one subtree.
const LEGACY_SETTINGS = {
  chapterTokenThreshold: 24000,
  classifierCadence: 5,
  piggybackMode: 'off',
  retrievalBudgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
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

  // Applying by filename stays green against a migration the app never runs; an
  // unjournalled 0011 fails storySettingsSchema on every upgraded story. A fresh DB
  // never needs the migration, so E2E cannot catch it either.
  it('is wired into the upgrade path, not just present on disk', () => {
    expect(migrationTags()).toContain(TAG)
    const runtime = readFileSync(`${MIGRATIONS_DIR}/migrations.js`, 'utf8')
    expect(runtime).toContain(`${TAG}.sql`)
  })

  it('creates the key on a settings blob that predates it', () => {
    insertStory(db, 's1', LEGACY_SETTINGS)
    expect(settingsOf(db, 's1')?.keywordRetrieval).toBeUndefined()

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')?.keywordRetrieval).toEqual(STORY_SETTINGS_DEFAULTS.keywordRetrieval)
  })

  it('leaves every sibling settings key untouched', () => {
    insertStory(db, 's1', LEGACY_SETTINGS)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toEqual({
      ...LEGACY_SETTINGS,
      keywordRetrieval: STORY_SETTINGS_DEFAULTS.keywordRetrieval,
    })
  })

  // A user-chosen mode must survive a re-run, so the statement is idempotent, unlike 0007.
  it('leaves a story that already carries the key alone', () => {
    const chosen = { ...STORY_SETTINGS_DEFAULTS.keywordRetrieval, mode: 'inject', scanEntries: 4 }
    insertStory(db, 's1', { ...LEGACY_SETTINGS, keywordRetrieval: chosen })

    applyMigration(db, TAG)
    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')?.keywordRetrieval).toEqual(chosen)
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

    expect(settingsOf(db, 's_good')?.keywordRetrieval).toEqual(
      STORY_SETTINGS_DEFAULTS.keywordRetrieval,
    )
    const bad = db.prepare('select settings from stories where id = ?').get('s_bad') as {
      settings: string
    }
    expect(bad.settings).toBe(raw)
  })

  // json_valid alone admits these, and json_set then rewrites the column re-serialized,
  // normalizing a row the migration must not touch. The spacing is the assertion.
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
