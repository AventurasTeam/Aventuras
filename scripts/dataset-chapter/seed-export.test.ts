import type { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { exportStorySeed } from './seed-export'
import { createTestDb } from '../../lib/db/__tests__/test-db'
import { buildSeedSteps, type SeedStep } from '../../lib/db/devtools/seed-dataset'
import { DATASET_SEED_TABLES, parseStorySeed, seedProviderIds } from '../seed/dataset-story'

type Row = Record<string, unknown>

const HERO = 'story_hero'
const HERO_MAIN = 'br_hero_main'
// Not shaped like a known key format, so only the scan for the database's own keys can catch it.
const KEY = 'dataset-test-key-0123456789abcdef'
const PROVIDERS = seedProviderIds(buildSeedSteps())

async function loaded(steps: readonly SeedStep[]): Promise<DatabaseSync> {
  const { db, sqlite } = await createTestDb()
  for (const { table, rows } of steps)
    for (let i = 0; i < rows.length; i += 100)
      await db.insert(table).values(rows.slice(i, i + 100) as never)
  return sqlite
}

const seeded = () => loaded(buildSeedSteps())
const exported = (sqlite: DatabaseSync, story = HERO) => exportStorySeed(sqlite, story, PROVIDERS)

function setProviderKey(sqlite: DatabaseSync, key: string): void {
  const { providers } = sqlite.prepare(`SELECT providers FROM app_settings`).get() as {
    providers: string
  }
  const keyed = (JSON.parse(providers) as Row[]).map((p) => ({ ...p, apiKey: key }))
  sqlite.prepare(`UPDATE app_settings SET providers = ?`).run(JSON.stringify(keyed))
}

describe('exportStorySeed', () => {
  it('writes only the story, every seeded table in insert order', async () => {
    const seed = JSON.parse(await exported(await seeded())) as Record<string, Row[]>
    expect(Object.keys(seed)).toEqual(DATASET_SEED_TABLES.map((spec) => spec.name))
    expect(seed.stories!.map((r) => r.id)).toEqual([HERO])
    expect(new Set(seed.branches!.map((r) => r.id))).toEqual(new Set([HERO_MAIN, 'br_hero_fork']))
    const heroDeltas = buildSeedSteps()
      .filter((s) => s.name === 'deltas')
      .flatMap((s) => s.rows as Row[])
      .filter((r) => r.branchId === HERO_MAIN || r.branchId === 'br_hero_fork')
    const logOrder = (rows: Row[]) =>
      rows.map((r) => `${r.branchId as string}:${r.logPosition as number}`)
    expect(logOrder(seed.deltas!)).toEqual(
      logOrder(
        heroDeltas.toSorted(
          (a, b) =>
            String(a.branchId).localeCompare(String(b.branchId)) ||
            (a.logPosition as number) - (b.logPosition as number),
        ),
      ),
    )
  })

  // A reversal re-inserts the rows it restores, so the order rows were written in is no order.
  it('orders rows by their place in the story, not by when they were written', async () => {
    const reversed = buildSeedSteps().map((s) => ({ ...s, rows: s.rows.toReversed() }))
    const seed = JSON.parse(await exported(await loaded(reversed))) as Record<string, Row[]>
    const main = seed.story_entries!.filter((r) => r.branchId === HERO_MAIN)
    expect(main.map((r) => r.position)).toEqual(main.map((_, i) => i + 1))
    expect(await exported(await loaded(reversed))).toBe(await exported(await seeded()))
  })

  it('writes the same bytes after its own seed loads in place of the story', async () => {
    const first = await exported(await seeded())
    const others = buildSeedSteps().map((s) => ({
      ...s,
      rows: (s.rows as Row[]).filter(
        (r) => r.id !== HERO && r.storyId !== HERO && !String(r.branchId).startsWith('br_hero_'),
      ),
    }))
    const reloaded = await loaded([...others, ...parseStorySeed(first, PROVIDERS)])
    expect(await exported(reloaded)).toBe(first)
  })

  it('marks every embedded row stale, since no vector goes with it', async () => {
    const sqlite = await seeded()
    for (const table of ['entities', 'lore', 'threads', 'happenings', 'chapters'])
      sqlite.exec(`UPDATE ${table} SET embedding_stale = 0`)
    const seed = JSON.parse(await exported(sqlite)) as Record<string, Row[]>
    for (const table of ['entities', 'lore', 'threads', 'happenings', 'chapters']) {
      expect(seed[table]!.length, table).toBeGreaterThan(0)
      for (const row of seed[table]!) expect(row.embeddingStale, table).toBe(1)
    }
  })

  it('refuses a story the database lacks', async () => {
    await expect(exported(await seeded(), 'story_missing')).rejects.toThrow(/story_missing/)
  })

  it('refuses a row its schema rejects', async () => {
    const sqlite = await seeded()
    sqlite.exec(`UPDATE threads SET status = 'abandoned' WHERE branch_id = '${HERO_MAIN}'`)
    await expect(exported(sqlite)).rejects.toThrow(/threads\[\d+\][\s\S]*status/)
  })

  it('refuses a provider key held anywhere in the story, without echoing it', async () => {
    const sqlite = await seeded()
    setProviderKey(sqlite, KEY)
    await expect(exported(sqlite)).resolves.toBeTypeOf('string')
    sqlite
      .prepare(
        `UPDATE branches SET classifier_status = json_set(classifier_status, '$.lastError', ?) WHERE id = ?`,
      )
      .run(`401 for key ${KEY}`, HERO_MAIN)
    const refusal = exported(sqlite)
    await expect(refusal).rejects.toThrow(/provider key/)
    await expect(refusal).rejects.not.toThrow(KEY)
  })

  it('refuses a short provider key it could not scan for', async () => {
    const sqlite = await seeded()
    setProviderKey(sqlite, 'Qz7')
    await expect(exported(sqlite)).rejects.toThrow(/would match unrelated text/)
  })

  it.each(['apiKey', 'api_key', 'Authorization', 'secret', 'password'])(
    'refuses a field named %s',
    async (field) => {
      const sqlite = await seeded()
      sqlite
        .prepare(
          `UPDATE deltas SET undo_payload = json_set(coalesce(undo_payload, '{}'), ?, 'x') WHERE branch_id = ? AND log_position = 1`,
        )
        .run(`$.${field}`, HERO_MAIN)
      await expect(exported(sqlite)).rejects.toThrow(
        new RegExp(`deltas\\[\\d+\\][\\s\\S]*${field}`),
      )
    },
  )

  it.each([
    ['an OpenAI-style key', 'the key was sk-proj-4f9aQ2xT7mLw0Rk3Vb8nZ1cY'],
    ['a bearer token', 'header Bearer eyJhbGciOiJIUzI1NiJ9.e30.Zm9vYmFy'],
  ])('refuses a value shaped like %s, without echoing it', async (_, text) => {
    const sqlite = await seeded()
    sqlite
      .prepare(`UPDATE story_entries SET content = ? WHERE branch_id = ? AND position = 3`)
      .run(text, HERO_MAIN)
    const refusal = exported(sqlite)
    await expect(refusal).rejects.toThrow(/story_entries\[\d+\][\s\S]*looks like a credential/)
    await expect(refusal).rejects.not.toThrow(text.split(' ').at(-1)!)
  })
})
