import type { DatabaseSync } from 'node:sqlite'

import { drizzle } from 'drizzle-orm/expo-sqlite/driver'
import { beforeEach, describe, expect, it } from 'vitest'

// Imported by its .native name: the unit project otherwise resolves the web read.
import { readChainSnapshot } from './chain-snapshot.native'
import { kaelFrom, seedChainSnapshot, STATE } from '../__tests__/chain-snapshot-seed'
import { createTestDb } from '../__tests__/test-db'
import { characterRelationships, dbSchema } from '../schema'

// The slice of expo-sqlite's sync API drizzle's expo session calls for a mapped select.
function expoOver(sqlite: DatabaseSync) {
  return {
    prepareSync(sql: string) {
      const stmt = sqlite.prepare(sql)
      stmt.setReturnArrays(true)
      return {
        executeForRawResultSync(params: unknown[]) {
          const rows = stmt.all(...(params as never[]))
          return { getAllSync: () => rows }
        },
      }
    },
  }
}

let expoDb: ReturnType<typeof drizzle<typeof dbSchema>>

beforeEach(async () => {
  const t = await createTestDb()
  await seedChainSnapshot(t)
  expoDb = drizzle(expoOver(t.sqlite) as unknown as Parameters<typeof drizzle>[0], {
    schema: dbSchema,
  })
})

describe('readChainSnapshot (native)', () => {
  it('reads the chain oldest first, by field name, on its own table and branch', async () => {
    const { chain } = await readChainSnapshot(expoDb, kaelFrom(2))

    expect(chain.map((d) => [d.id, d.branchId, d.targetTable, d.logPosition])).toEqual([
      ['d_traits', 'b1', 'entities', 2],
      ['d_voice', 'b1', 'entities', 4],
    ])
    expect(chain[0].undoPayload).toEqual({ state: { traits: ['brave'] } })
    expect(chain[0]).not.toHaveProperty('target_table')
  })

  it("reads the requested branch's row with its JSON parsed", async () => {
    const { row } = await readChainSnapshot(expoDb, kaelFrom(2, 'b2'))

    expect(row).toMatchObject({ id: 'char_kael', branchId: 'b2', name: 'Kael of the fork' })
    expect(row?.state).toEqual(STATE)
  })

  it('maps a row by field name', async () => {
    const { row } = await readChainSnapshot(expoDb, {
      ...kaelFrom(2),
      targetId: 'rel_1',
      row: {
        table: characterRelationships,
        idCol: characterRelationships.id,
        branchCol: characterRelationships.branchId,
      },
    })

    expect(row).toMatchObject({ id: 'rel_1', kind: 'rival', inverseKind: 'wary' })
    expect(row).not.toHaveProperty('inverse_kind')
  })

  it('reads a missing row as null', async () => {
    expect(await readChainSnapshot(expoDb, { ...kaelFrom(2), targetId: 'char_gone' })).toEqual({
      chain: [],
      row: null,
    })
  })
})
