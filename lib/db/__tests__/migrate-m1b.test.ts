import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import {
  branchEraFlips,
  branches,
  characterRelationships,
  happeningAwareness,
  happenings,
  stories,
  translations,
} from '@/lib/db'

import { createTestDb } from './test-db'

const MIGRATIONS_DIR = 'lib/db/migrations'

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

const NEW_TABLES = [
  'entities',
  'lore',
  'threads',
  'happenings',
  'character_relationships',
  'chapters',
  'branch_era_flips',
  'translations',
  'probe_captures',
  'happening_involvements',
  'happening_awareness',
  'entry_assets',
  'assets',
  'vault_calendars',
]

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
}

describe('M1.5 migration', () => {
  it('creates every new relational table (vec0 excluded)', async () => {
    const { sqlite } = await createTestDb()
    const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string
    }[]
    const names = new Set(rows.map((r) => r.name))
    for (const t of NEW_TABLES) expect(names.has(t)).toBe(true)
    expect(names.has('entities_vec')).toBe(false)
  })

  it('completes app_settings / branches / deltas columns + enum', async () => {
    const { sqlite } = await createTestDb()
    const cols = (table: string) =>
      new Set(
        (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
          (c) => c.name,
        ),
      )
    expect(cols('app_settings').has('appearance')).toBe(true)
    expect(cols('app_settings').has('default_story_settings')).toBe(true)
    expect(cols('branches').has('classifier_status')).toBe(true)
  })

  it('rejects happenings with both occurred_at_entry_id and temporal set', async () => {
    const { db } = await createTestDb()
    await seed(db)
    await expect(
      db.insert(happenings).values({
        id: 'h1',
        branchId: 'b1',
        title: 'Test happening',
        occurredAtEntryId: 'entry_5',
        temporal: '1200-05-01',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).rejects.toThrow()
  })

  it('rejects character_relationships with a_id >= b_id', async () => {
    const { db } = await createTestDb()
    await seed(db)
    await expect(
      db.insert(characterRelationships).values({
        id: 'cr1',
        branchId: 'b1',
        aId: 'zzzz',
        bId: 'aaaa',
        kind: 'enemy',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).rejects.toThrow()
  })

  it('rejects character_relationships with both kind and inverse_kind null', async () => {
    const { db } = await createTestDb()
    await seed(db)
    await expect(
      db.insert(characterRelationships).values({
        id: 'cr2',
        branchId: 'b1',
        aId: 'char_a',
        bId: 'char_b',
        kind: null,
        inverseKind: null,
        createdAt: 1,
        updatedAt: 1,
      }),
    ).rejects.toThrow()
  })

  it('rejects duplicate happening_awareness (same branch_id+character_id+happening_id)', async () => {
    const { db } = await createTestDb()
    await seed(db)
    const base = {
      branchId: 'b1',
      happeningId: 'hap1',
      characterId: 'char1',
    } as const
    await db.insert(happeningAwareness).values({ id: 'ha1', ...base })
    await expect(db.insert(happeningAwareness).values({ id: 'ha2', ...base })).rejects.toThrow()
  })

  it('rejects duplicate translations (same natural key)', async () => {
    const { db } = await createTestDb()
    await seed(db)
    const base = {
      branchId: 'b1',
      targetKind: 'entity' as const,
      targetId: 'ent1',
      field: 'name',
      language: 'fr',
      createdAt: 1,
      updatedAt: 1,
    }
    await db.insert(translations).values({ id: 'tr1', ...base })
    await expect(db.insert(translations).values({ id: 'tr2', ...base })).rejects.toThrow()
  })

  it('rejects duplicate branch_era_flips (same branch_id + at_worldtime)', async () => {
    const { db } = await createTestDb()
    await seed(db)
    await db
      .insert(branchEraFlips)
      .values({ id: 'ef1', branchId: 'b1', atWorldtime: 1000, eraName: 'Age of Ash', createdAt: 1 })
    await expect(
      db.insert(branchEraFlips).values({
        id: 'ef2',
        branchId: 'b1',
        atWorldtime: 1000,
        eraName: 'Age of Storms',
        createdAt: 1,
      }),
    ).rejects.toThrow()
  })

  it('rejects a negative at_worldtime (DB CHECK)', async () => {
    const { db } = await createTestDb()
    await seed(db)
    await expect(
      db
        .insert(branchEraFlips)
        .values({ id: 'ef3', branchId: 'b1', atWorldtime: -1, eraName: 'Before', createdAt: 1 }),
    ).rejects.toThrow()
  })

  // Regression: createTestDb applies every migration to a fresh (empty) db in one
  // shot, so it can't catch an ALTER that only fails on a populated table. SQLite
  // rejects `ADD COLUMN ... DEFAULT <non-constant> NOT NULL` once app_settings holds
  // its singleton, which is the state of every real incremental upgrade.
  it('applies later migrations onto an already-seeded app_settings', () => {
    const tags = migrationTags()
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    applyMigration(sqlite, tags[0]) // creates app_settings
    sqlite.exec("INSERT INTO app_settings (id) VALUES ('singleton')")
    for (const tag of tags.slice(1)) {
      expect(() => applyMigration(sqlite, tag), `migration ${tag}`).not.toThrow()
    }

    const row = sqlite.prepare('SELECT created_at, updated_at FROM app_settings').get() as {
      created_at: number
      updated_at: number
    }
    expect(row.created_at).toBe(0)
    expect(row.updated_at).toBe(0)
    sqlite.close()
  })
})
