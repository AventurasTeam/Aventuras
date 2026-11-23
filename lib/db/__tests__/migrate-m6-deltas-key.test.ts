import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, MIGRATIONS_DIR, migrationTags } from './test-db'

// By name, not number: a migration that lands first renumbers these steps.
const KEY_STEP = '_m6_deltas_key'
const BACKFILL_STEP = '_m6_pipeline_runs_branch'

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean }
type Row = Record<string, unknown>
type Runner = (sqlite: DatabaseSync, tags: readonly string[]) => void

function journalEntries(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
    entries: JournalEntry[]
  }
  return journal.entries
}

function tagEnding(suffix: string): string {
  const tag = migrationTags().find((t) => t.endsWith(suffix))
  if (tag === undefined) throw new Error(`no migration tag ends with ${suffix}`)
  return tag
}

// Desktop: the sqlite-proxy migrator hands initDb a flat statement list that it execs one by one
// (electron/db/service.ts), so the rebuild's PRAGMA foreign_keys=OFF takes effect.
function migrateLikeDesktop(sqlite: DatabaseSync, tags: readonly string[]): void {
  for (const tag of tags) applyMigration(sqlite, tag)
}

// Android: expo's migrator runs every pending step between one BEGIN and COMMIT, preparing each
// breakpoint chunk as one statement, so PRAGMA foreign_keys does nothing there.
function migrateLikeAndroid(sqlite: DatabaseSync, tags: readonly string[]): void {
  sqlite.exec('BEGIN')
  try {
    for (const tag of tags) {
      const chunks = readFileSync(`${MIGRATIONS_DIR}/${tag}.sql`, 'utf8').split(
        '--> statement-breakpoint',
      )
      for (const chunk of chunks) if (chunk.trim()) sqlite.prepare(chunk).run()
    }
    sqlite.exec('COMMIT')
  } catch (err) {
    sqlite.exec('ROLLBACK')
    throw err
  }
}

const RUNNERS: [string, Runner][] = [
  ['desktop', migrateLikeDesktop],
  ['android', migrateLikeAndroid],
]

function openMigratedTo(tags: readonly string[]): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:', { allowExtension: true })
  sqlite.loadExtension(getLoadablePath())
  sqlite.exec('PRAGMA foreign_keys = ON;')
  for (const tag of tags) applyMigration(sqlite, tag)
  return sqlite
}

const T = 1_767_225_600_000

// Spaced as no JSON serializer writes it, so a rebuild that re-serializes the payload changes it.
const DELETE_PAYLOAD =
  '{"name": "Øren Vále",  "id": "char_oren", "branchId": "br_x", "kind": "character", ' +
  '"status": "active", "relationships": [{"id": "rel_oren_mira", "branchId": "br_x", ' +
  '"aId": "char_mira", "bId": "char_oren", "kind": "rival", "inverseKind": "rival", ' +
  '"createdAt": 1767225000000, "updatedAt": 1767225000000}], "awareness": [{"id": ' +
  '"haw_oren_bridge", "branchId": "br_x", "happeningId": "hap_bridge", "characterId": ' +
  '"char_oren", "learnedAtEntryId": "e_x1", "retrievalCount": 0, "source": null}]}'

const JOURNAL_Y =
  '{"version":1,"chapterId":"ch_gone","chapterNumber":2,"floor":0,"rows":[],"deltas":[],"journals":[]}'

// Inserted out of run_id order, so the rowid check below can tell a reorder.
const RUNS: SQLInputValue[][] = [
  ['run_turn_done', 'per-turn', 'act_turn_done', 's_one', T, T + 5, 'completed', null],
  ['run_close_z', 'chapter-close', 'act_close_z', 's_two', T + 1, T + 6, 'completed', null],
  ['run_turn_x', 'per-turn', 'act_turn_x', 's_one', T + 10, null, null, null],
  ['run_rerun_y', 'chapter-close', 'act_rerun_y', 's_one', T + 11, null, null, 'ch_gone'],
  ['run_rerun_z', 'chapter-close', 'act_rerun_z', 's_two', T + 12, null, null, 'ch_z1'],
  ['run_rerun_lost', 'chapter-close', 'act_rerun_lost', 's_two', T + 13, null, null, 'ch_missing'],
  ['run_bare', 'per-turn', 'act_bare', 's_one', T + 14, null, null, null],
]

const BACKFILL_CASES: [label: string, runId: string, branchId: string | null][] = [
  ['an unfinished run with deltas on X', 'run_turn_x', 'br_x'],
  ['an unfinished re-run with a journal on Y and no delta', 'run_rerun_y', 'br_y'],
  ['an unfinished re-run whose chapter is on Z, with no delta or journal', 'run_rerun_z', 'br_z'],
  [
    "an unfinished re-run naming a chapter that isn't there, with no delta or journal",
    'run_rerun_lost',
    null,
  ],
  ['an unfinished run with none of the three', 'run_bare', null],
  ['a finished run with deltas', 'run_turn_done', null],
  ['a finished close with deltas', 'run_close_z', null],
]

function insertAll(sqlite: DatabaseSync, sql: string, rows: SQLInputValue[][]): void {
  const stmt = sqlite.prepare(sql)
  for (const row of rows) stmt.run(...row)
}

function populate(sqlite: DatabaseSync): void {
  insertAll(sqlite, 'INSERT INTO stories (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    ['s_one', 'One', T, T],
    ['s_two', 'Two', T, T],
  ])
  insertAll(sqlite, 'INSERT INTO branches (id, story_id, name, created_at) VALUES (?, ?, ?, ?)', [
    ['br_x', 's_one', 'main', T],
    ['br_y', 's_one', 'side', T],
    ['br_z', 's_two', 'main', T],
  ])
  insertAll(
    sqlite,
    `INSERT INTO chapters (id, branch_id, sequence_number, title, summary, theme, start_entry_id,
       end_entry_id, token_count, closed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      [
        'ch_z1',
        'br_z',
        1,
        'The Ferry',
        'They cross at dusk.',
        'passage',
        'e_z1',
        'e_z9',
        4200,
        T,
        T,
        T,
      ],
    ],
  )
  insertAll(
    sqlite,
    `INSERT INTO deltas (id, branch_id, entry_id, action_id, log_position, source, target_table,
       target_id, op, undo_payload, encoding_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      [
        'd_x1',
        'br_x',
        'e_x2',
        'act_turn_done',
        1,
        'per_turn_classifier',
        'lore',
        'lore_harrow',
        'update',
        '{"body":"The old ford."}',
        T,
      ],
      [
        'd_x2',
        'br_x',
        'e_x3',
        'act_turn_x',
        2,
        'ai_classifier',
        'entities',
        'char_mira',
        'create',
        null,
        T + 10,
      ],
      [
        'd_x3',
        'br_x',
        'e_x3',
        'act_turn_x',
        3,
        'ai_classifier',
        'entities',
        'char_oren',
        'delete',
        DELETE_PAYLOAD,
        T + 10,
      ],
      [
        'd_z1',
        'br_z',
        'e_z9',
        'act_close_z',
        1,
        'chapter_close',
        'entities',
        'char_tobin',
        'update',
        '{"description":"A ferryman."}',
        T + 1,
      ],
    ],
  )
  insertAll(
    sqlite,
    'INSERT INTO reversal_journals (action_id, branch_id, journal, created_at) VALUES (?, ?, ?, ?)',
    [['act_rerun_y', 'br_y', JOURNAL_Y, T + 11]],
  )
  insertAll(
    sqlite,
    `INSERT INTO pipeline_runs (run_id, kind, action_id, story_id, started_at, finished_at, outcome,
       rerun_chapter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    RUNS,
  )
}

function readDeltas(sqlite: DatabaseSync): Row[] {
  return sqlite.prepare('SELECT * FROM deltas ORDER BY branch_id, id').all() as Row[]
}

function keyColumns(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[])
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name)
}

function indexColumns(sqlite: DatabaseSync, index: string): string[] {
  return (sqlite.prepare(`PRAGMA index_info(${index})`).all() as { seqno: number; name: string }[])
    .sort((a, b) => a.seqno - b.seqno)
    .map((c) => c.name)
}

function runIdsByRowid(sqlite: DatabaseSync): string[] {
  return (
    sqlite.prepare('SELECT run_id FROM pipeline_runs ORDER BY rowid').all() as {
      run_id: string
    }[]
  ).map((r) => r.run_id)
}

function branchOf(sqlite: DatabaseSync, runId: string): unknown {
  const row = sqlite.prepare('SELECT branch_id FROM pipeline_runs WHERE run_id = ?').get(runId) as
    | { branch_id: unknown }
    | undefined
  if (row === undefined) throw new Error(`no run ${runId}`)
  return row.branch_id
}

describe.each(RUNNERS)(
  'the deltas key and the run branch, migrated as %s does',
  (_name, migrate) => {
    let sqlite: DatabaseSync
    let keyBefore: string[]
    let deltasBefore: Row[]
    let runOrderBefore: string[]

    beforeAll(() => {
      const tags = migrationTags()
      const at = tags.indexOf(tagEnding(KEY_STEP))
      sqlite = openMigratedTo(tags.slice(0, at))
      populate(sqlite)
      keyBefore = keyColumns(sqlite, 'deltas')
      deltasBefore = readDeltas(sqlite)
      runOrderBefore = runIdsByRowid(sqlite)
      migrate(sqlite, tags.slice(at))
    })

    afterAll(() => {
      sqlite.close()
    })

    it('starts from a populated deltas table keyed on id alone', () => {
      expect(keyBefore).toEqual(['id'])
      expect(deltasBefore).toHaveLength(4)
    })

    it('reads every deltas row back equal in every column, payload text included', () => {
      expect(readDeltas(sqlite)).toEqual(deltasBefore)
    })

    it('keys deltas on (branch_id, id)', () => {
      expect(keyColumns(sqlite, 'deltas')).toEqual(['branch_id', 'id'])
    })

    it('recreates both deltas indexes on their columns', () => {
      const indexes = sqlite.prepare('PRAGMA index_list(deltas)').all() as {
        name: string
        unique: number
      }[]
      expect(indexes.find((i) => i.name === 'deltas_chain_idx')?.unique).toBe(0)
      expect(indexes.find((i) => i.name === 'deltas_log_position_uniq')?.unique).toBe(1)
      expect(indexColumns(sqlite, 'deltas_chain_idx')).toEqual([
        'branch_id',
        'target_id',
        'log_position',
      ])
      expect(indexColumns(sqlite, 'deltas_log_position_uniq')).toEqual([
        'branch_id',
        'log_position',
      ])
    })

    it('leaves no foreign-key violation, and foreign keys on', () => {
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(sqlite.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    })

    it('adds pipeline_runs.branch_id as a key to branches.id and keeps the rows in rowid order', () => {
      const keys = (
        sqlite.prepare('PRAGMA foreign_key_list(pipeline_runs)').all() as {
          from: string
          table: string
          to: string
        }[]
      ).map((k) => [k.from, k.table, k.to])
      expect(keys).toEqual([['branch_id', 'branches', 'id']])
      expect(runIdsByRowid(sqlite)).toEqual(runOrderBefore)
    })

    it.each(BACKFILL_CASES)('backfills %s', (_label, runId, branchId) => {
      expect(branchOf(sqlite, runId)).toBe(branchId)
    })
  },
)

describe('the M6 migration steps on disk', () => {
  // Android looks each step up by its journal idx in the bundle, not its filename: a step missing
  // from the bundle, or bound to another step's file, breaks boot there while desktop boots fine.
  it('are wired into the native bundle, the backfill right after the rebuild', () => {
    const tags = migrationTags()
    const key = tagEnding(KEY_STEP)
    const backfill = tagEnding(BACKFILL_STEP)
    expect(tags.indexOf(backfill)).toBe(tags.indexOf(key) + 1)
    const bundle = readFileSync(`${MIGRATIONS_DIR}/migrations.js`, 'utf8')
    for (const tag of [key, backfill]) {
      const entry = journalEntries().find((e) => e.tag === tag)
      if (entry === undefined) throw new Error(`no journal entry for ${tag}`)
      const name = `m${String(entry.idx).padStart(4, '0')}`
      expect(bundle).toMatch(new RegExp(`^import ${name} from '\\./${tag}\\.sql'$`, 'm'))
      expect(bundle).toMatch(new RegExp(`^\\s*${name},\\s*$`, 'm'))
    }
  })

  // Both migrators apply only steps stamped above the last one applied, so a database already at
  // the rebuild would never take a backfill stamped at or below it.
  it('stamps every journal entry after the one before it', () => {
    const entries = journalEntries()
    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i)
      expect(entry.tag.startsWith(String(i).padStart(4, '0'))).toBe(true)
      if (i > 0) expect(entry.when).toBeGreaterThan(entries[i - 1].when)
    })
    const whenOf = (tag: string) => entries.find((e) => e.tag === tag)?.when ?? Number.NaN
    expect(whenOf(tagEnding(BACKFILL_STEP))).toBeGreaterThan(whenOf(tagEnding(KEY_STEP)))
  })
})
