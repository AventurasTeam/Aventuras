import { beforeEach, describe, expect, it } from 'vitest'

import { branches, deltas, stories, type DbCtx, type NewDelta } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { loadHistoryChunk, type HistoryQuery } from './query'

let db: DbCtx['db']

function delta(
  logPosition: number,
  op: NewDelta['op'],
  undoPayload: Record<string, unknown> | null,
  targetId = 'char_1',
): NewDelta {
  return {
    id: `delta_${logPosition}`,
    branchId: 'b1',
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
      delta(6, 'delete', { id: 'char_1', name: 'Kael' }),
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

  it('finds updates touching a field path and nothing that merely mentions it', async () => {
    expect(await positions({ search: 'state.traits' })).toEqual([2])
  })

  it('finds a path whose pre-change value was the null sentinel', async () => {
    expect(await positions({ search: 'state.voice' })).toEqual([5])
  })

  it('matches free text and label paths', async () => {
    expect(await positions({ search: 'traits' })).toEqual([4, 2])
    expect(await positions({ search: 'zzz', labelPaths: ['state.drives'] })).toEqual([3])
  })

  it('filters by op, and matches an op typed into search', async () => {
    expect(await positions({ op: 'delete' })).toEqual([6])
    expect(await positions({ search: 'create' })).toEqual([1])
  })

  it('pages by log position in either sort, and reports the end', async () => {
    const first = await loadHistoryChunk(db, { ...base, limit: 4 })
    expect(first.rows.map((row) => row.logPosition)).toEqual([6, 5, 4, 3])
    const second = await loadHistoryChunk(db, { ...base, limit: 4, cursor: first.nextCursor })
    expect(second.rows.map((row) => row.logPosition)).toEqual([2, 1])
    expect(second.nextCursor).toBeNull()
    expect(await positions({ sort: 'oldest', limit: 2 })).toEqual([1, 2])
  })
})
