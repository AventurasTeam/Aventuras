import { beforeEach, describe, expect, it } from 'vitest'

import { FIRST_LOGGED_AT } from '@/lib/actions/delta/user-precedence'
import { branches, deltas, stories, type DbCtx, type NewDelta } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { loadHistoryChunk, type HistoryQuery } from './query'

let db: DbCtx['db']

function delta(
  logPosition: number,
  op: NewDelta['op'],
  undoPayload: Record<string, unknown> | null,
  targetId = 'char_1',
  branchId = 'b1',
): NewDelta {
  return {
    id: `delta_${logPosition}`,
    branchId,
    entryId: null,
    actionId: `act_${logPosition}`,
    logPosition,
    source: 'user_edit',
    targetTable: 'entities',
    targetId,
    op,
    undoPayload,
    createdAt: logPosition,
  }
}

// Full pre-delete row (data-model.md → Delta storage economy), incl. a state.traits key —
// regression fixture pinning the op=update gate so field-search skips this delete echo.
const FULL_ROW_DELETE_PAYLOAD = {
  id: 'char_1',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'A ranger',
  status: 'active',
  retiredReason: null,
  injectionMode: 'auto',
  nameCollisionFlag: 0,
  state: {
    visual: {},
    traits: ['brave'],
    drives: [],
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: null,
    lastSeenAt: null,
  },
  tags: [],
  keywords: [],
  priority: 0,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(async () => {
  const test = await createTestDb()
  db = test.db
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db
    .insert(deltas)
    .values([
      delta(1, 'create', null),
      delta(2, 'update', { state: { traits: ['brave'] } }),
      delta(3, 'update', { state: { drives: ['home'] } }),
      delta(4, 'update', { description: 'lists her traits' }),
      delta(5, 'update', { state: { voice: null } }),
      delta(6, 'delete', FULL_ROW_DELETE_PAYLOAD),
      delta(7, 'update', { state: { traits: [] } }, 'char_2'),
    ])
})

const base: HistoryQuery = {
  branchId: 'b1',
  targetTable: 'entities',
  targetId: 'char_1',
  sort: 'newest',
  cursor: null,
}
const positions = async (query: Partial<HistoryQuery>) =>
  (await loadHistoryChunk(db, { ...base, ...query })).rows.map((row) => row.logPosition)

describe('loadHistoryChunk', () => {
  it("reads one target's rows newest first", async () => {
    expect(await positions({})).toEqual([6, 5, 4, 3, 2, 1])
  })

  it('finds updates touching a field path, never a delete that merely echoes it in the full row', async () => {
    expect(await positions({ search: 'state.traits' })).toEqual([2])
  })

  it('finds a path whose pre-change value was the null sentinel', async () => {
    expect(await positions({ search: 'state.voice' })).toEqual([5])
  })

  it('matches free text', async () => {
    expect(await positions({ search: 'traits' })).toEqual([4, 2])
  })

  it('resolves a typed field label to the paths it names, though the payload never spells it', async () => {
    await db.insert(deltas).values(delta(8, 'update', { state: { stackables: { arrows: 3 } } }))
    expect(await positions({ search: 'quantities' })).toEqual([8])
  })

  it('filters by op, and matches an op typed into search, never a delete row echoing it', async () => {
    expect(await positions({ op: 'delete' })).toEqual([6])
    expect(await positions({ search: 'create' })).toEqual([1])
  })

  it('matches a translated op / filter-chip / summary label typed into search', async () => {
    expect(await positions({ search: 'Created' })).toEqual([1])
    expect(await positions({ search: 'modified' })).toEqual([5, 4, 3, 2])
  })

  it('pages by log position in either sort, and reports the end', async () => {
    const first = await loadHistoryChunk(db, { ...base, limit: 4 })
    expect(first.rows.map((row) => row.logPosition)).toEqual([6, 5, 4, 3])
    const second = await loadHistoryChunk(db, { ...base, limit: 4, cursor: first.nextCursor })
    expect(second.rows.map((row) => row.logPosition)).toEqual([2, 1])
    expect(second.nextCursor).toBeNull()
    expect(await positions({ sort: 'oldest', limit: 2 })).toEqual([1, 2])
  })

  it('reports no further cursor when a chunk exactly fills the limit', async () => {
    const result = await loadHistoryChunk(db, { ...base, limit: 6 })
    expect(result.rows.map((row) => row.logPosition)).toEqual([6, 5, 4, 3, 2, 1])
    expect(result.nextCursor).toBeNull()
  })

  it('pages oldest-first forward with a cursor', async () => {
    const first = await loadHistoryChunk(db, { ...base, sort: 'oldest', limit: 4 })
    expect(first.rows.map((row) => row.logPosition)).toEqual([1, 2, 3, 4])
    expect(first.nextCursor).toBe(4)
    const second = await loadHistoryChunk(db, {
      ...base,
      sort: 'oldest',
      limit: 4,
      cursor: first.nextCursor,
    })
    expect(second.rows.map((row) => row.logPosition)).toEqual([5, 6])
    expect(second.nextCursor).toBeNull()
  })

  it('never crosses into another branch holding a delta with the same target id', async () => {
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'alt', createdAt: 1 })
    await db
      .insert(deltas)
      .values(delta(99, 'update', { description: 'other branch' }, 'char_1', 'b2'))
    expect(await positions({})).toEqual([6, 5, 4, 3, 2, 1])
  })
})

describe('LIKE escaping', () => {
  it('treats a % in the term as a literal character, not a wildcard', async () => {
    await db
      .insert(deltas)
      .values([
        delta(20, 'update', { description: 'Buy one, get 50% off' }),
        delta(21, 'update', { description: '50 items counted' }),
      ])
    expect(await positions({ search: '50%' })).toEqual([20])
  })

  it('treats a _ in the term as a literal character, not a single-char wildcard', async () => {
    await db
      .insert(deltas)
      .values([
        delta(22, 'update', { description: 'file_name here' }),
        delta(23, 'update', { description: 'fileXname here' }),
      ])
    expect(await positions({ search: 'file_name' })).toEqual([22])
  })

  it('matches text the payload stores JSON-escaped, and a bare quote only where a value holds one', async () => {
    await db
      .insert(deltas)
      .values([
        delta(24, 'update', { description: 'she said "hi"' }),
        delta(25, 'update', { description: 'C:\\maps\\north' }),
      ])
    expect(await positions({ search: '"hi"' })).toEqual([24])
    expect(await positions({ search: '"' })).toEqual([24])
    expect(await positions({ search: 'C:\\maps' })).toEqual([25])
  })
})

describe('payload meta keys', () => {
  it('never matches a meta key or its value, only the columns beside it', async () => {
    await db
      .insert(deltas)
      .values(delta(30, 'update', { description: 'moonlit', [FIRST_LOGGED_AT]: 987654 }))
    expect(await positions({ search: 'logged' })).toEqual([])
    expect(await positions({ search: '987654' })).toEqual([])
    expect(await positions({ search: 'moonlit' })).toEqual([30])
  })
})
