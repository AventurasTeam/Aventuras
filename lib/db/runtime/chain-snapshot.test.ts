import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readChainSnapshot } from './chain-snapshot'
import { chainSnapshotQueries, type ChainSnapshotArgs } from './chain-snapshot-queries'
import { createTestDb, makeBatchCallback, makeCallback } from '../__tests__/test-db'
import type { CharacterState } from '../entities/entities-types'
import { branches, characterRelationships, dbSchema, deltas, entities, stories } from '../schema'
import type { Delta, NewEntity } from '../types'

let t: Awaited<ReturnType<typeof createTestDb>>

const STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  voice: 'low and dry',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const KAEL: NewEntity = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  status: 'active',
  injectionMode: 'auto',
  state: STATE,
  createdAt: 1,
  updatedAt: 1,
}

const delta = (id: string, logPosition: number, over: Partial<Delta> = {}): Delta => ({
  id,
  branchId: 'b1',
  entryId: null,
  actionId: `act_${id}`,
  logPosition,
  source: 'user_edit',
  targetTable: 'entities',
  targetId: 'char_kael',
  op: 'update',
  undoPayload: null,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

const ENTITY_ROW = { table: entities, idCol: entities.id, branchCol: entities.branchId }

const kaelFrom = (fromLogPosition: number, branchId = 'b1'): ChainSnapshotArgs => ({
  branchId,
  targetTable: 'entities',
  targetId: 'char_kael',
  fromLogPosition,
  row: ENTITY_ROW,
})

beforeEach(async () => {
  t = await createTestDb()
  // Unordered reads come back reversed, so only the read's ORDER BY yields the chain oldest first.
  t.sqlite.exec('PRAGMA reverse_unordered_selects = ON')
  await t.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await t.db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  await t.db.insert(entities).values([KAEL, { ...KAEL, branchId: 'b2', name: 'Kael of the fork' }])
  await t.db.insert(characterRelationships).values({
    id: 'rel_1',
    branchId: 'b1',
    aId: 'char_kael',
    bId: 'char_mira',
    kind: 'rival',
    inverseKind: 'wary',
    createdAt: 1,
    updatedAt: 1,
  })
  // Out of log order on purpose: the index, not the insert, would order an unordered scan.
  await t.db
    .insert(deltas)
    .values([
      delta('d_voice', 4, { undoPayload: { state: { voice: 'hoarse' } } }),
      delta('d_lore', 3, { targetTable: 'lore', undoPayload: { title: 'Kael' } }),
      delta('d_traits', 2, { undoPayload: { state: { traits: ['brave'] } } }),
      delta('d_create', 1, { op: 'create' }),
      delta('d_create', 1, { branchId: 'b2', op: 'create' }),
      delta('d_fork', 2, { branchId: 'b2', undoPayload: { name: 'Kael' } }),
    ])
})

describe('readChainSnapshot', () => {
  it('reads the chain from the requested position, oldest first, on its own table', async () => {
    const { chain } = await readChainSnapshot(t.db, kaelFrom(2))

    expect(chain.map((d) => [d.id, d.op, d.undoPayload])).toEqual([
      ['d_traits', 'update', { state: { traits: ['brave'] } }],
      ['d_voice', 'update', { state: { voice: 'hoarse' } }],
    ])
  })

  it('takes every op, by field name, from the first position', async () => {
    const { chain } = await readChainSnapshot(t.db, kaelFrom(1))

    expect(chain.map((d) => d.id)).toEqual(['d_create', 'd_traits', 'd_voice'])
    expect(chain[0]).toMatchObject({
      branchId: 'b1',
      targetTable: 'entities',
      logPosition: 1,
      op: 'create',
    })
    expect(chain[0]).not.toHaveProperty('log_position')
  })

  it('reads both halves on the requested branch alone', async () => {
    const main = await readChainSnapshot(t.db, kaelFrom(1))
    const fork = await readChainSnapshot(t.db, kaelFrom(1, 'b2'))

    expect(main.chain.map((d) => d.id)).not.toContain('d_fork')
    expect(fork.chain.map((d) => [d.id, d.branchId])).toEqual([
      ['d_create', 'b2'],
      ['d_fork', 'b2'],
    ])
    expect(main.row?.name).toBe('Kael')
    expect(fork.row?.name).toBe('Kael of the fork')
  })

  it('maps the row: field names, and a JSON column parsed', async () => {
    const { row } = await readChainSnapshot(t.db, kaelFrom(1))
    expect(row?.state).toEqual(STATE)

    const pair = await readChainSnapshot(t.db, {
      branchId: 'b1',
      targetTable: 'character_relationships',
      targetId: 'rel_1',
      fromLogPosition: 1,
      row: {
        table: characterRelationships,
        idCol: characterRelationships.id,
        branchCol: characterRelationships.branchId,
      },
    })
    expect(pair.row).toMatchObject({ id: 'rel_1', kind: 'rival', inverseKind: 'wary' })
    expect(pair.row).not.toHaveProperty('inverse_kind')
    expect(pair.chain).toEqual([])
  })

  it('reads a missing row as null', async () => {
    expect(await readChainSnapshot(t.db, { ...kaelFrom(1), targetId: 'char_gone' })).toEqual({
      chain: [],
      row: null,
    })
  })

  it('reads both halves in one batch call and no single query', async () => {
    const batch = vi.fn(makeBatchCallback(t.sqlite))
    const query = vi.fn(makeCallback(t.sqlite))
    const spied = drizzle(query, batch, { schema: dbSchema })

    const { chain, row } = await readChainSnapshot(spied, kaelFrom(2))

    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0].map((q) => q.method)).toEqual(['all', 'all'])
    expect(query).not.toHaveBeenCalled()
    expect(chain.map((d) => d.id)).toEqual(['d_traits', 'd_voice'])
    expect(row?.name).toBe('Kael')
  })

  it("plans the chain on deltas_chain_idx, in the index's order", () => {
    const { sql, params } = chainSnapshotQueries(t.db, kaelFrom(2)).chain.toSQL()
    const plan = (
      t.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as {
        detail: string
      }[]
    )
      .map((step) => step.detail)
      .join('\n')

    expect(plan).toContain('USING INDEX deltas_chain_idx')
    expect(plan).not.toContain('TEMP B-TREE')
  })
})
