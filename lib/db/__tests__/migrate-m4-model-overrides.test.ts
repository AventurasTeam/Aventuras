import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = 'lib/db/migrations'
const TAG = '0014_story_model_overrides_provider'

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

// Every override target as of 0014, hardcoded: a later target never held a bare id.
const LEGACY_SETTINGS = {
  chapterTokenThreshold: 24000,
  classifierCadence: 5,
  models: {
    narrative: 'm-narr',
    classifier: 'm-cls',
    translation: 'm-tr',
    suggestion: 'm-sug',
    'lore-mgmt': 'm-lore',
    retrieval: 'm-ret',
  },
  packVariables: { tone: 'wry' },
}

const ADOPTED_MODELS = {
  narrative: { providerId: 'prov_default', modelId: 'm-narr' },
  classifier: { providerId: 'prov_default', modelId: 'm-cls' },
  translation: { providerId: 'prov_default', modelId: 'm-tr' },
  suggestion: { providerId: 'prov_default', modelId: 'm-sug' },
  'lore-mgmt': { providerId: 'prov_default', modelId: 'm-lore' },
  retrieval: { providerId: 'prov_default', modelId: 'm-ret' },
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

function insertAppSettings(db: DatabaseSync, defaultProviderId: string | null): void {
  db.prepare(
    `insert into app_settings (id, providers, profiles, assignments, default_provider_id, created_at, updated_at)
     values ('singleton', '[]', '[]', '{}', ?, 1, 1)`,
  ).run(defaultProviderId)
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

  it('is wired into the upgrade path, not just present on disk', () => {
    expect(migrationTags()).toContain(TAG)
    const runtime = readFileSync(`${MIGRATIONS_DIR}/migrations.js`, 'utf8')
    expect(runtime).toContain(`${TAG}.sql`)
    expect(runtime).toMatch(/^\s*m0014,\s*$/m)
  })

  it('adopts the default provider for every bare-id override', () => {
    insertAppSettings(db, 'prov_default')
    insertStory(db, 's1', LEGACY_SETTINGS)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toEqual({ ...LEGACY_SETTINGS, models: ADOPTED_MODELS })
  })

  it('drops bare-id overrides when no default provider is set', () => {
    insertAppSettings(db, null)
    insertStory(db, 's1', LEGACY_SETTINGS)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toEqual({ ...LEGACY_SETTINGS, models: {} })
  })

  // Adopting a blank id would mint a modelId the schema refuses, so the story's
  // whole blob would stop parsing — a recovery dialog instead of one lost override.
  it('drops a blank bare-id override even with a default provider set', () => {
    insertAppSettings(db, 'prov_default')
    insertStory(db, 's1', {
      ...LEGACY_SETTINGS,
      models: { narrative: '', classifier: '   ', translation: 'm-tr' },
    })

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')?.models).toEqual({
      translation: { providerId: 'prov_default', modelId: 'm-tr' },
    })
  })

  it('leaves an already-qualified override and every sibling key untouched', () => {
    insertAppSettings(db, 'prov_default')
    const qualified = {
      ...LEGACY_SETTINGS,
      models: { classifier: { providerId: 'prov_other', modelId: 'm-cls' } },
    }
    insertStory(db, 's1', qualified)

    applyMigration(db, TAG)
    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toEqual(qualified)
  })

  it('leaves a story with no models key alone', () => {
    insertAppSettings(db, 'prov_default')
    insertStory(db, 's1', { chapterTokenThreshold: 1 })

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toEqual({ chapterTokenThreshold: 1 })
  })

  it.each([
    ['unparseable text', '{not json'],
    ['an empty string', ''],
    ['a top-level array', '[1,2]'],
  ])('migrates good rows beside %s', (_label, raw) => {
    insertAppSettings(db, 'prov_default')
    insertStory(db, 's_good', LEGACY_SETTINGS)
    db.prepare(
      'insert into stories (id, title, settings, created_at, updated_at) values (?,?,?,?,?)',
    ).run('s_bad', 's_bad', raw, 1, 1)

    expect(() => applyMigration(db, TAG)).not.toThrow()

    expect(settingsOf(db, 's_good')?.models).toEqual(ADOPTED_MODELS)
    const bad = db.prepare('select settings from stories where id = ?').get('s_bad') as {
      settings: string
    }
    expect(bad.settings).toBe(raw)
  })

  it('leaves a wizard draft with no settings blob null', () => {
    insertAppSettings(db, 'prov_default')
    insertStory(db, 's1', null)

    applyMigration(db, TAG)

    expect(settingsOf(db, 's1')).toBeNull()
  })
})
