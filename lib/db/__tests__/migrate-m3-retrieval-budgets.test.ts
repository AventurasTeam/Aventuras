import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORY_SETTINGS_DEFAULTS } from '@/lib/db'

const MIGRATIONS_DIR = 'lib/db/migrations'
const TAG = '0007_retrieval_budget_tokens'

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

// The pre-slice shape: row counts, plus enough sibling keys to prove the
// migration rewrites one subtree rather than the settings blob.
const LEGACY_SETTINGS = {
  chapterTokenThreshold: 24000,
  classifierCadence: 5,
  piggybackMode: 'off',
  retrievalBudgets: { entities: 8, lore: 6, happenings: 6, threads: 4, chapters: 3 },
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
    // Everything BEFORE the budget migration, so each test seeds the shape a
    // real upgrade would be holding rather than a post-migration one.
    for (const tag of migrationTags()) {
      if (tag === TAG) break
      applyMigration(db, tag)
    }
  })

  it('rewrites a count-shaped retrievalBudgets to the shipped token budgets', () => {
    insertStory(db, 's1', LEGACY_SETTINGS)
    // Positive control: the fixture really is count-shaped before the migration,
    // so the assertion below is about the rewrite and not about the seed.
    expect(settingsOf(db, 's1')?.retrievalBudgets).toEqual(LEGACY_SETTINGS.retrievalBudgets)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')?.retrievalBudgets).toEqual(STORY_SETTINGS_DEFAULTS.retrievalBudgets)
  })

  it('leaves every sibling settings key untouched', () => {
    insertStory(db, 's1', LEGACY_SETTINGS)

    applyMigration(db, TAG)

    const after = settingsOf(db, 's1')
    expect(after).toEqual({
      ...LEGACY_SETTINGS,
      retrievalBudgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
    })
  })

  it('creates the key on a settings blob that predates it', () => {
    insertStory(db, 's1', { classifierCadence: 5 })

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toEqual({
      classifierCadence: 5,
      retrievalBudgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
    })
  })

  it('leaves a wizard draft with no settings blob null rather than writing one', () => {
    insertStory(db, 's1', null)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toBeNull()
  })

  it('does not touch updated_at — the user did not edit the story', () => {
    insertStory(db, 's1', LEGACY_SETTINGS)

    applyMigration(db, TAG)

    const row = db.prepare('select updated_at from stories where id = ?').get('s1') as {
      updated_at: number
    }
    expect(row.updated_at).toBe(1)
  })
})
