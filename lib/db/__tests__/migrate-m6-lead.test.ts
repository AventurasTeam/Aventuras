import { readFileSync } from 'node:fs'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { journalEntries, openMigratedTo, RUNNERS, tagEnding } from './migration-runners'
import { MIGRATIONS_DIR, migrationTags } from './test-db'
import { storyDefinitionSchema } from '../stories/story-config-schema'

// By name, not number: a migration that lands first renumbers these steps.
const COLUMN_STEP = '_m6_entities_is_lead'
const BACKFILL_STEP = '_m6_lead_backfill'
const CHECK_STEP = '_m6_entities_lead_check'

type Row = Record<string, unknown>

const T = 1_767_225_600_000

const SCENE = { sceneEntities: [], currentLocationId: null, worldTime: 0 }
const MALFORMED = '{"sceneEntities": ['
// Past SQLite's JSON parser depth: json_valid reads it as 0, while json_type and json_set raise.
const OVER_DEEP = `${'{"a":'.repeat(3000)}1${'}'.repeat(3000)}`

function definition(over: Record<string, unknown>): string {
  return JSON.stringify({
    mode: 'adventure',
    leadEntityId: null,
    narration: 'second',
    genre: { label: 'Fantasy', promptBody: 'High fantasy.' },
    tone: { label: 'Wry', promptBody: '' },
    setting: 'A keep on a hill.',
    calendarSystemId: 'gregorian',
    worldTimeOrigin: { year: 0 },
    ...over,
  })
}

const meta = (over: Record<string, unknown> = {}) => JSON.stringify({ ...SCENE, ...over })

const STORIES: [id: string, status: string, stored: string][] = [
  ['s_adv', 'active', definition({ leadEntityId: 'char_kael' })],
  [
    's_first',
    'active',
    definition({ mode: 'creative', narration: 'first', leadEntityId: 'char_ivo' }),
  ],
  ['s_third', 'active', definition({ mode: 'creative', narration: 'third', leadEntityId: null })],
  ['s_loc', 'active', definition({ narration: 'third', leadEntityId: 'loc_keep' })],
  ['s_draft', 'draft', definition({ leadEntityId: 'char_draft' })],
  ['s_bad', 'active', '{"mode": "adventure", "leadEntityId": "char_x"'],
  ['s_deep', 'active', OVER_DEEP],
]

/** The stories whose stored definition is a readable object. */
const READABLE_STORIES = ['s_adv', 's_first', 's_third', 's_loc', 's_draft']

const BRANCHES: [id: string, storyId: string][] = [
  ['br_adv_main', 's_adv'],
  ['br_adv_fork', 's_adv'],
  ['br_adv_side', 's_adv'],
  ['br_first', 's_first'],
  ['br_third', 's_third'],
  ['br_loc', 's_loc'],
  ['br_bad', 's_bad'],
  ['br_deep', 's_deep'],
]

const ENTITIES: [id: string, branchId: string, kind: string, status: string][] = [
  ['char_kael', 'br_adv_main', 'character', 'active'],
  ['char_mira', 'br_adv_main', 'character', 'active'],
  ['char_kael', 'br_adv_fork', 'character', 'staged'],
  ['char_mira', 'br_adv_side', 'character', 'active'],
  ['char_ivo', 'br_first', 'character', 'retired'],
  ['char_ana', 'br_third', 'character', 'active'],
  ['loc_keep', 'br_loc', 'location', 'active'],
  ['char_x', 'br_bad', 'character', 'active'],
  ['char_kael', 'br_deep', 'character', 'active'],
]

const ENTRIES: [id: string, branchId: string, kind: string, metadata: string | null][] = [
  ['e_adv_open', 'br_adv_main', 'opening', meta()],
  ['e_adv_act', 'br_adv_main', 'user_action', meta({ worldTime: 5 })],
  ['e_adv_reply', 'br_adv_main', 'ai_reply', meta({ sceneEntities: ['char_kael'] })],
  ['e_adv_sys', 'br_adv_main', 'system', null],
  // No code writes object metadata on a system row; here the kind filter, not NULL, excludes it.
  ['e_adv_sys_obj', 'br_adv_main', 'system', meta()],
  ['e_adv_malformed', 'br_adv_main', 'user_action', MALFORMED],
  ['e_adv_deep', 'br_adv_main', 'user_action', OVER_DEEP],
  ['e_fork_reply', 'br_adv_fork', 'ai_reply', meta()],
  ['e_side_act', 'br_adv_side', 'user_action', meta()],
  ['e_side_reply', 'br_adv_side', 'ai_reply', meta()],
  ['e_first_open', 'br_first', 'opening', meta()],
  ['e_first_act', 'br_first', 'user_action', meta()],
  ['e_first_reply', 'br_first', 'ai_reply', meta()],
  ['e_first_sys', 'br_first', 'system', null],
  ['e_third_reply', 'br_third', 'ai_reply', meta()],
  ['e_loc_reply', 'br_loc', 'ai_reply', meta()],
  ['e_bad_reply', 'br_bad', 'ai_reply', meta()],
  ['e_deep_reply', 'br_deep', 'ai_reply', meta()],
]

const STAMPED: [entryId: string, leadId: string][] = [
  ['e_adv_open', 'char_kael'],
  ['e_adv_act', 'char_kael'],
  ['e_adv_reply', 'char_kael'],
  ['e_fork_reply', 'char_kael'],
  ['e_first_open', 'char_ivo'],
  ['e_first_act', 'char_ivo'],
  ['e_first_reply', 'char_ivo'],
]

function insertAll(sqlite: DatabaseSync, sql: string, rows: SQLInputValue[][]): void {
  const stmt = sqlite.prepare(sql)
  for (const row of rows) stmt.run(...row)
}

function populate(sqlite: DatabaseSync): void {
  insertAll(
    sqlite,
    `INSERT INTO stories (id, title, status, definition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    STORIES.map(([id, status, stored]) => [id, id, status, stored, T, T]),
  )
  insertAll(
    sqlite,
    'INSERT INTO branches (id, story_id, name, created_at) VALUES (?, ?, ?, ?)',
    BRANCHES.map(([id, storyId]) => [id, storyId, id, T]),
  )
  insertAll(
    sqlite,
    `INSERT INTO entities (id, branch_id, kind, name, status, injection_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'auto', ?, ?)`,
    ENTITIES.map(([id, branchId, kind, status]) => [id, branchId, kind, id, status, T, T]),
  )
  insertAll(
    sqlite,
    `INSERT INTO story_entries (id, branch_id, position, kind, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ENTRIES.map(([id, branchId, kind, metadata], i) => [
      id,
      branchId,
      i + 1,
      kind,
      `Prose of ${id}.`,
      metadata,
      T,
    ]),
  )
}

function columnsOf(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  )
}

function readEntities(sqlite: DatabaseSync, columns: readonly string[]): Row[] {
  const list = columns.map((c) => `"${c}"`).join(', ')
  return sqlite.prepare(`SELECT ${list} FROM entities ORDER BY branch_id, id`).all() as Row[]
}

function flaggedRows(sqlite: DatabaseSync): Row[] {
  return sqlite
    .prepare('SELECT branch_id, id FROM entities WHERE is_lead = 1 ORDER BY branch_id, id')
    .all() as Row[]
}

function metadataById(sqlite: DatabaseSync): Map<string, string | null> {
  const rows = sqlite.prepare('SELECT id, metadata FROM story_entries ORDER BY id').all() as {
    id: string
    metadata: string | null
  }[]
  return new Map(rows.map((r) => [r.id, r.metadata]))
}

function definitionById(sqlite: DatabaseSync): Map<string, string | null> {
  const rows = sqlite.prepare('SELECT id, definition FROM stories ORDER BY id').all() as {
    id: string
    definition: string | null
  }[]
  return new Map(rows.map((r) => [r.id, r.definition]))
}

function parsed(text: string | null | undefined): Record<string, unknown> {
  return JSON.parse(text ?? 'null') as Record<string, unknown>
}

function insertEntity(sqlite: DatabaseSync, id: string, kind: string, isLead: number): void {
  sqlite
    .prepare(
      `INSERT INTO entities (id, branch_id, kind, name, status, injection_mode, is_lead, created_at,
         updated_at) VALUES (?, 'br_third', ?, ?, 'active', 'auto', ?, ?, ?)`,
    )
    .run(id, kind, id, isLead, T, T)
}

// A probe write the later cases mustn't see.
function rolledBack(sqlite: DatabaseSync, write: () => void): void {
  sqlite.exec('BEGIN')
  try {
    write()
  } finally {
    sqlite.exec('ROLLBACK')
  }
}

describe.each(RUNNERS)('the lead backfill, migrated as %s does', (_name, migrate) => {
  let sqlite: DatabaseSync
  let migrateError: unknown
  let columnsBefore: string[]
  let entitiesBefore: Row[]
  let metadataBefore: Map<string, string | null>
  let definitionsBefore: Map<string, string | null>

  beforeAll(() => {
    const tags = migrationTags()
    const at = tags.indexOf(tagEnding(COLUMN_STEP))
    sqlite = openMigratedTo(tags.slice(0, at))
    populate(sqlite)
    columnsBefore = columnsOf(sqlite, 'entities')
    entitiesBefore = readEntities(sqlite, columnsBefore)
    metadataBefore = metadataById(sqlite)
    definitionsBefore = definitionById(sqlite)
    try {
      migrate(sqlite, tags.slice(at))
    } catch (err) {
      migrateError = err
    }
  })

  afterAll(() => {
    sqlite.close()
  })

  it('runs every step without throwing, past a malformed and an over-deep blob', () => {
    expect(migrateError).toBeUndefined()
  })

  it('starts from an entities table with no is_lead, and adds it not null, default 0', () => {
    expect(columnsBefore).not.toContain('is_lead')
    const column = (
      sqlite.prepare('PRAGMA table_info(entities)').all() as {
        name: string
        notnull: number
        dflt_value: string | null
      }[]
    ).find((c) => c.name === 'is_lead')
    expect(column).toMatchObject({ notnull: 1, dflt_value: '0' })
  })

  it("flags the stored lead's character row on every branch holding it, any status, and nothing else", () => {
    expect(flaggedRows(sqlite)).toEqual([
      { branch_id: 'br_adv_fork', id: 'char_kael' },
      { branch_id: 'br_adv_main', id: 'char_kael' },
      { branch_id: 'br_first', id: 'char_ivo' },
    ])
  })

  it.each(STAMPED)('stamps %s with %s, keeping its other keys', (entryId, leadId) => {
    expect(parsed(metadataById(sqlite).get(entryId))).toEqual({
      ...parsed(metadataBefore.get(entryId)),
      leadId,
    })
  })

  it('leaves every other entry byte for byte: system rows, unflagged branches, unreadable blobs', () => {
    const after = metadataById(sqlite)
    const stamped = new Set(STAMPED.map(([id]) => id))
    for (const [id, before] of metadataBefore)
      if (!stamped.has(id)) expect(after.get(id), id).toBe(before)
  })

  it("leaves a flagged branch's malformed and over-deep metadata as it was", () => {
    const after = metadataById(sqlite)
    expect(after.get('e_adv_malformed')).toBe(MALFORMED)
    expect(after.get('e_adv_deep')).toBe(OVER_DEEP)
  })

  it('drops leadEntityId from every readable definition, the draft and a null lead included', () => {
    const after = definitionById(sqlite)
    for (const id of READABLE_STORIES) {
      const expected = parsed(definitionsBefore.get(id))
      delete expected.leadEntityId
      const stored = parsed(after.get(id))
      expect(stored, id).toEqual(expected)
      expect(Object.hasOwn(stored, 'leadEntityId'), id).toBe(false)
    }
  })

  it('leaves every readable definition parsing as story open parses it', () => {
    const after = definitionById(sqlite)
    for (const id of READABLE_STORIES) {
      expect(storyDefinitionSchema.safeParse(parsed(after.get(id))).success, id).toBe(true)
    }
  })

  it('leaves an unreadable definition as it was', () => {
    const after = definitionById(sqlite)
    for (const id of ['s_bad', 's_deep']) expect(after.get(id), id).toBe(definitionsBefore.get(id))
  })

  it('reads every entities row back equal in every column it had', () => {
    expect(readEntities(sqlite, columnsBefore)).toEqual(entitiesBefore)
  })

  it('refuses a flag on a row that is no character, and a flag other than 0 or 1', () => {
    const refusal = /CHECK constraint failed: entities_lead_character/
    expect(() => rolledBack(sqlite, () => insertEntity(sqlite, 'loc_new', 'location', 1))).toThrow(
      refusal,
    )
    expect(() =>
      rolledBack(sqlite, () => insertEntity(sqlite, 'char_new', 'character', 2)),
    ).toThrow(refusal)
    expect(() =>
      rolledBack(sqlite, () =>
        sqlite.prepare("UPDATE entities SET is_lead = 1 WHERE id = 'loc_keep'").run(),
      ),
    ).toThrow(refusal)
    expect(() =>
      rolledBack(sqlite, () => insertEntity(sqlite, 'char_new', 'character', 1)),
    ).not.toThrow()
  })

  it('recreates entities_stale_idx, partial, on branch_id', () => {
    const index = (
      sqlite.prepare('PRAGMA index_list(entities)').all() as { name: string; partial: number }[]
    ).find((i) => i.name === 'entities_stale_idx')
    expect(index?.partial).toBe(1)
    expect(
      (sqlite.prepare('PRAGMA index_info(entities_stale_idx)').all() as { name: string }[]).map(
        (c) => c.name,
      ),
    ).toEqual(['branch_id'])
  })

  it('leaves no foreign-key violation, and foreign keys on', () => {
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})

describe('the lead migration steps on disk', () => {
  // Android looks each step up by its journal idx in the bundle, not its filename: a step missing
  // from the bundle, or bound to another step's file, breaks boot there while desktop boots fine.
  it('are wired into the native bundle, the column, then the backfill, then the check', () => {
    const tags = migrationTags()
    const steps = [tagEnding(COLUMN_STEP), tagEnding(BACKFILL_STEP), tagEnding(CHECK_STEP)]
    const at = tags.indexOf(steps[0])
    expect(steps.map((tag) => tags.indexOf(tag))).toEqual([at, at + 1, at + 2])
    const bundle = readFileSync(`${MIGRATIONS_DIR}/migrations.js`, 'utf8')
    for (const tag of steps) {
      const entry = journalEntries().find((e) => e.tag === tag)
      if (entry === undefined) throw new Error(`no journal entry for ${tag}`)
      const name = `m${String(entry.idx).padStart(4, '0')}`
      expect(bundle).toMatch(new RegExp(`^import ${name} from '\\./${tag}\\.sql'$`, 'm'))
      expect(bundle).toMatch(new RegExp(`^\\s*${name},\\s*$`, 'm'))
    }
  })
})

// AC3: story open parses each definition the chain leaves, the adventure story whose branch it
// can't flag and the draft included.
describe.each(RUNNERS)(
  'stored definitions after the lead steps, migrated as %s does',
  (_name, migrate) => {
    const AT = 1_767_225_600_000
    const definitionOf = (mode: string, narration: string, leadEntityId: string | null) => ({
      mode,
      leadEntityId,
      narration,
      genre: { label: 'Fantasy', promptBody: 'High fantasy.' },
      tone: { label: 'Wry', promptBody: 'Dry humor.' },
      setting: 'A keep on a hill.',
      calendarSystemId: 'gregorian',
      worldTimeOrigin: { year: 1 },
    })
    const STORIES = [
      {
        id: 's_led',
        status: 'active',
        definition: definitionOf('adventure', 'second', 'char_led'),
      },
      {
        id: 's_unflagged',
        status: 'active',
        definition: definitionOf('adventure', 'third', 'char_gone'),
      },
      { id: 's_ensemble', status: 'active', definition: definitionOf('creative', 'third', null) },
      {
        id: 's_draft',
        status: 'draft',
        definition: definitionOf('adventure', 'first', 'char_unsaved'),
      },
    ]
    let sqlite: DatabaseSync
    let stored: Map<string, unknown>

    beforeAll(() => {
      const tags = migrationTags()
      const at = tags.indexOf(tagEnding('_m6_entities_is_lead'))
      sqlite = openMigratedTo(tags.slice(0, at))
      const story = sqlite.prepare(
        'INSERT INTO stories (id, title, status, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      for (const s of STORIES) story.run(s.id, s.id, s.status, JSON.stringify(s.definition), AT, AT)
      const branch = sqlite.prepare(
        'INSERT INTO branches (id, story_id, name, created_at) VALUES (?, ?, ?, ?)',
      )
      branch.run('br_led', 's_led', 'main', AT)
      branch.run('br_unflagged', 's_unflagged', 'main', AT)
      branch.run('br_ensemble', 's_ensemble', 'main', AT)
      const character = sqlite.prepare(
        `INSERT INTO entities (id, branch_id, kind, name, status, injection_mode, created_at, updated_at)
         VALUES (?, ?, 'character', ?, 'active', 'auto', ?, ?)`,
      )
      character.run('char_led', 'br_led', 'Led', AT, AT)
      character.run('char_bystander', 'br_unflagged', 'Bystander', AT, AT)
      migrate(sqlite, tags.slice(at))
      const rows = sqlite.prepare('SELECT id, definition FROM stories').all() as {
        id: string
        definition: string
      }[]
      stored = new Map(rows.map((row) => [row.id, JSON.parse(row.definition) as unknown]))
    })

    afterAll(() => {
      sqlite.close()
    })

    it('flags no row on the branch whose stored lead names no character', () => {
      expect(
        sqlite
          .prepare("SELECT id FROM entities WHERE branch_id = 'br_unflagged' AND is_lead = 1")
          .all(),
      ).toEqual([])
    })

    it.each(STORIES.map((s) => s.id))(
      'stores %s as a definition story open parses unchanged',
      (id) => {
        const definition = stored.get(id)
        expect(definition).toBeDefined()
        expect(storyDefinitionSchema.parse(definition)).toEqual(definition)
      },
    )
  },
)
