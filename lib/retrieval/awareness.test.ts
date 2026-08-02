import type { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { branches, happeningAwareness, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { loadAwarenessForScene } from './awareness'
import type { QueryAll } from './types'

// Mirrors lib/db/runtime/exec.ts's queryRows: rows arrive as arrays of values
// in SELECT order, which is what the positional destructure depends on.
const queryAllOf =
  (sqlite: DatabaseSync): QueryAll =>
  async (sql, params) =>
    (sqlite.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]).map((r) =>
      Object.values(r),
    )

type AwarenessSeed = {
  id: string
  branchId: string
  characterId: string
  happeningId: string
  learnedAtEntryId?: string | null
  decayResistance?: number | null
  source?: string | null
}

async function setup(rows: AwarenessSeed[]) {
  const { db, sqlite } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 },
  ])
  if (rows.length > 0) await db.insert(happeningAwareness).values(rows)
  return queryAllOf(sqlite)
}

describe('loadAwarenessForScene', () => {
  it('returns the union of the in-scene characters, and no one else', async () => {
    const queryAll = await setup([
      { id: 'ha_a', branchId: 'br_1', characterId: 'char_a', happeningId: 'hap_1' },
      { id: 'ha_b', branchId: 'br_1', characterId: 'char_b', happeningId: 'hap_2' },
      { id: 'ha_c', branchId: 'br_1', characterId: 'char_c', happeningId: 'hap_3' },
    ])
    const rows = await loadAwarenessForScene(queryAll, 'br_1', ['char_a', 'char_b'])
    expect(rows.map((r) => r.id).sort()).toEqual(['ha_a', 'ha_b'])
  })

  it('scopes the union to the branch when the same character exists on two', async () => {
    const queryAll = await setup([
      { id: 'ha_1', branchId: 'br_1', characterId: 'char_a', happeningId: 'hap_1' },
      { id: 'ha_2', branchId: 'br_2', characterId: 'char_a', happeningId: 'hap_1' },
    ])
    const rows = await loadAwarenessForScene(queryAll, 'br_1', ['char_a'])
    expect(rows.map((r) => r.id)).toEqual(['ha_1'])
  })

  it('maps each selected column onto its own field', async () => {
    const queryAll = await setup([
      {
        id: 'ha_1',
        branchId: 'br_1',
        characterId: 'char_a',
        happeningId: 'hap_1',
        learnedAtEntryId: 'entry_9',
        decayResistance: 0.4,
        source: 'Kara saw it',
      },
    ])
    expect(await loadAwarenessForScene(queryAll, 'br_1', ['char_a'])).toEqual([
      {
        id: 'ha_1',
        happeningId: 'hap_1',
        characterId: 'char_a',
        learnedAtEntryId: 'entry_9',
        decayResistance: 0.4,
        source: 'Kara saw it',
      },
    ])
  })

  it('keeps the nullable awareness columns null rather than coercing them', async () => {
    const queryAll = await setup([
      {
        id: 'ha_1',
        branchId: 'br_1',
        characterId: 'char_a',
        happeningId: 'hap_1',
        learnedAtEntryId: null,
        decayResistance: null,
        source: null,
      },
    ])
    const [row] = await loadAwarenessForScene(queryAll, 'br_1', ['char_a'])
    expect(row.learnedAtEntryId).toBeNull()
    expect(row.decayResistance).toBeNull()
    expect(row.source).toBeNull()
  })

  it('returns nothing without querying when the scene has no characters', async () => {
    const queryAll = vi.fn<QueryAll>(async () => [])
    expect(await loadAwarenessForScene(queryAll, 'br_1', [])).toEqual([])
    expect(queryAll).not.toHaveBeenCalled()
  })
})
