import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readChainSnapshot } from './chain-snapshot'
import { chainSnapshotQueries } from './chain-snapshot-queries'
import { kaelFrom, seedChainSnapshot, STATE } from '../__tests__/chain-snapshot-seed'
import { createTestDb, makeBatchCallback, makeCallback } from '../__tests__/test-db'
import { characterRelationships, dbSchema } from '../schema'

let t: Awaited<ReturnType<typeof createTestDb>>

beforeEach(async () => {
  t = await createTestDb()
  await seedChainSnapshot(t)
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

  it("maps the row: field names, a JSON column parsed; reads the row's own table's chain", async () => {
    const { row } = await readChainSnapshot(t.db, kaelFrom(1))
    expect(row?.state).toEqual(STATE)

    const pair = await readChainSnapshot(t.db, {
      branchId: 'b1',
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
    expect(pair.chain.map((d) => d.id)).toEqual(['d_rel'])
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
