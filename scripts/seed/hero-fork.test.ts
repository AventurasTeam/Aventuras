import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ensureVecTablesSql, isVecFamilyTable, sourceHash } from '@/lib/db'
import { countTokens } from '@/lib/tokens'

import { parseCli } from './cli'
import { seedDatabase } from './run'
import { openTestDb } from '../../lib/db/__tests__/test-db'
import { branchSnapshot } from '../../lib/db/__tests__/two-branch'
import { plantVec } from '../../lib/db/__tests__/vec-fixtures'
import {
  HERO_FORK as WEB_HERO_FORK,
  heroForkTurns as webHeroForkTurns,
} from '../../lib/db/devtools/hero-fork.web'
import { HERO_FORK } from '../../lib/db/devtools/seed-dataset'

type Entry = { id: string; position: number; kind: string; content: string }
type Create = {
  target_id: string
  log_position: number
  source: string
  entry_id: string | null
  action_id: string
}

const FORK = 'br_hero_fork'
const MAIN = 'br_hero_main'
const OWN = [
  'entry_fork_0001',
  'entry_fork_0002',
  'entry_fork_0003',
  'entry_fork_0004',
  'entry_fork_0005',
]

let dir: string
const files: DatabaseSync[] = []

// AC 20: through the script's own path, twice, so the two files compare byte for byte.
beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  dir = mkdtempSync(join(tmpdir(), 'hero-fork-'))
  for (const name of ['a.db', 'b.db']) {
    const path = join(dir, name)
    await seedDatabase(path, parseCli([path]))
    files.push(new DatabaseSync(path))
  }
}, 120_000)

afterAll(() => {
  for (const file of files) file.close()
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const seeded = (): DatabaseSync => files[0]!

function entriesOf(branchId: string): Entry[] {
  return seeded()
    .prepare(
      'SELECT id, position, kind, content FROM story_entries WHERE branch_id = ? ORDER BY position',
    )
    .all(branchId) as Entry[]
}

describe('the seeded br_hero_fork (C7)', () => {
  it("forks br_hero_main at entry 40, and main stays the story's current branch", () => {
    const db = seeded()
    expect(
      db
        .prepare(
          'SELECT id, story_id, name, parent_branch_id, fork_entry_id, created_at FROM branches WHERE id = ?',
        )
        .get(FORK),
    ).toEqual({
      id: FORK,
      story_id: 'story_hero',
      name: 'The road not taken',
      parent_branch_id: MAIN,
      fork_entry_id: 'entry_hero_0040',
      created_at: 1_767_312_000_000,
    })
    expect(
      db
        .prepare('SELECT kind FROM story_entries WHERE branch_id = ? AND id = ?')
        .get(FORK, 'entry_hero_0040'),
    ).toEqual({ kind: 'user_action' })
    expect(
      db.prepare('SELECT current_branch_id FROM stories WHERE id = ?').get('story_hero'),
    ).toEqual({
      current_branch_id: MAIN,
    })
  })

  it("holds main's entries through the fork entry, then five turns of its own ending on a reply", () => {
    const main = entriesOf(MAIN)
    const fork = entriesOf(FORK)
    const through = main.findIndex((entry) => entry.id === 'entry_hero_0040') + 1
    expect(through).toBe(40)
    expect(fork.slice(0, through)).toEqual(main.slice(0, through))
    expect(fork.slice(through).map((entry) => [entry.id, entry.position, entry.kind])).toEqual([
      ['entry_fork_0001', 41, 'ai_reply'],
      ['entry_fork_0002', 42, 'user_action'],
      ['entry_fork_0003', 43, 'ai_reply'],
      ['entry_fork_0004', 44, 'user_action'],
      ['entry_fork_0005', 45, 'ai_reply'],
    ])
    for (const id of OWN)
      expect(
        seeded().prepare('SELECT branch_id FROM story_entries WHERE id = ?').all(id),
        id,
      ).toEqual([{ branch_id: FORK }])
  })

  it('writes its turns as the seed writes main: counted, naming entities the fork holds', () => {
    const db = seeded()
    for (const id of OWN) {
      const row = db
        .prepare(
          'SELECT content, content_tokens, metadata FROM story_entries WHERE branch_id = ? AND id = ?',
        )
        .get(FORK, id) as { content: string; content_tokens: number; metadata: string }
      expect(row.content_tokens, id).toBe(countTokens(row.content))
      const metadata = JSON.parse(row.metadata) as {
        sceneEntities: string[]
        currentLocationId: string
      }
      expect(metadata.sceneEntities, id).toHaveLength(2)
      for (const named of [...metadata.sceneEntities, metadata.currentLocationId])
        expect(
          db
            .prepare('SELECT 1 AS held FROM entities WHERE branch_id = ? AND id = ?')
            .get(FORK, named),
          `${id} names ${named}`,
        ).toEqual({ held: 1 })
    }
  })

  it('logs one create per turn of its own, above every delta the fork copied', () => {
    const db = seeded()
    const creates = db
      .prepare(
        `SELECT target_id, log_position, source, entry_id, action_id FROM deltas
         WHERE branch_id = ? AND target_table = 'story_entries' AND op = 'create'
           AND target_id LIKE 'entry_fork_%' ORDER BY log_position`,
      )
      .all(FORK) as Create[]
    expect(creates.map((create) => create.target_id)).toEqual(OWN)
    const { top } = db
      .prepare(
        `SELECT MAX(log_position) AS top FROM deltas WHERE branch_id = ? AND target_id NOT LIKE 'entry_fork_%'`,
      )
      .get(FORK) as { top: number }
    expect(top).toBeGreaterThan(0)
    expect(creates.map((create) => create.log_position)).toEqual([
      top + 1,
      top + 2,
      top + 3,
      top + 4,
      top + 5,
    ])
    expect(creates.map((create) => create.source)).toEqual([
      'ai_classifier',
      'user_edit',
      'ai_classifier',
      'user_edit',
      'ai_classifier',
    ])
    expect(creates.map((create) => create.entry_id)).toEqual([null, null, null, null, null])
    expect(new Set(creates.map((create) => create.action_id)).size).toBe(5)
  })

  it('parks its watermark at its last non-system entry', () => {
    const db = seeded()
    const { last } = db
      .prepare(
        `SELECT MAX(position) AS last FROM story_entries WHERE branch_id = ? AND kind <> 'system'`,
      )
      .get(FORK) as { last: number }
    expect(last).toBe(45)
    const { status } = db
      .prepare('SELECT classifier_status AS status FROM branches WHERE id = ?')
      .get(FORK) as { status: string }
    expect(JSON.parse(status)).toEqual({
      state: 'idle',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: 45,
    })
  })

  it('seeds the same br_hero_fork rows, byte for byte, on every run', () => {
    const [a, b] = files as [DatabaseSync, DatabaseSync]
    const rows = branchSnapshot(a, FORK)
    expect(rows.story_entries).toHaveLength(45)
    expect(rows.deltas!.length).toBeGreaterThan(45)
    expect(branchSnapshot(b, FORK)).toEqual(rows)
    const branchRow = (db: DatabaseSync) =>
      db.prepare('SELECT * FROM branches WHERE id = ?').get(FORK)
    expect(branchRow(b)).toEqual(branchRow(a))
  })
})

describe('the web bundle stub', () => {
  it("names the seed's fork and builds no turns", () => {
    expect(WEB_HERO_FORK).toEqual(HERO_FORK)
    expect(() => webHeroForkTurns(0)).toThrow(/pnpm db:seed/)
  })
})

// The wipe reaches no vec0 table through dbSchema, and the fork copies main's vectors under keys
// a later reseed's copy would collide with.
describe('reseeding a database whose main was embedded', () => {
  let reseedDir: string
  beforeAll(() => {
    reseedDir = mkdtempSync(join(tmpdir(), 'hero-fork-reseed-'))
  })
  afterAll(() => rmSync(reseedDir, { recursive: true, force: true }))

  async function plantMainVectors(path: string): Promise<void> {
    const opened = await openTestDb(path)
    try {
      for (const ddl of ensureVecTablesSql(8)) opened.sqlite.exec(ddl)
      const { id } = opened.sqlite
        .prepare(`SELECT id FROM entities WHERE branch_id = ? ORDER BY id LIMIT 1`)
        .get(MAIN) as { id: string }
      for (const dim of [384, 8])
        plantVec(opened.sqlite, {
          kind: 'entity',
          id,
          branchId: MAIN,
          modelId: `m${dim}`,
          dim,
          sourceHash: sourceHash('h'),
          vector: new Uint8Array(new Float32Array(dim).buffer),
        })
    } finally {
      opened.sqlite.close()
    }
  }

  async function seededState(
    path: string,
  ): Promise<{ forks: number; vectors: Record<string, number> }> {
    const { sqlite } = await openTestDb(path)
    try {
      const { forks } = sqlite
        .prepare('SELECT COUNT(*) AS forks FROM branches WHERE id = ?')
        .get(FORK) as { forks: number }
      const tables = (
        sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
          name: string
        }[]
      )
        .map((row) => row.name)
        .filter(isVecFamilyTable)
      const vectors = Object.fromEntries(
        tables.map((table) => [
          table,
          (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
        ]),
      )
      return { forks, vectors }
    } finally {
      sqlite.close()
    }
  }

  it('wipes every vector family, so each later seed forks again', async () => {
    const path = join(reseedDir, 'dev.db')
    await seedDatabase(path, parseCli([path]))
    await plantMainVectors(path)
    for (let run = 1; run <= 2; run++) {
      await seedDatabase(path, parseCli([path]))
      const { forks, vectors } = await seededState(path)
      expect(forks, `reseed ${run}`).toBe(1)
      expect(Object.keys(vectors), `reseed ${run}`).toEqual(
        expect.arrayContaining(['entities_vec_384', 'entities_vec_8']),
      )
      expect(
        Object.entries(vectors).filter(([, n]) => n > 0),
        `reseed ${run}`,
      ).toEqual([])
    }
  }, 120_000)
})
