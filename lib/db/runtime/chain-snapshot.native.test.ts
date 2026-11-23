import type { DatabaseSync } from 'node:sqlite'

import { drizzle } from 'drizzle-orm/expo-sqlite/driver'
import { beforeEach, describe, expect, it } from 'vitest'

// Imported by its .native name: the unit project otherwise resolves the web read.
import { readChainSnapshot } from './chain-snapshot.native'
import { createTestDb } from '../__tests__/test-db'
import type { CharacterState } from '../entities/entities-types'
import { branches, characterRelationships, dbSchema, deltas, entities, stories } from '../schema'
import type { Delta, NewEntity } from '../types'

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

const kael = (targetId = 'char_kael', branchId = 'b1') => ({
  branchId,
  targetId,
  fromLogPosition: 2,
  row: { table: entities, idCol: entities.id, branchCol: entities.branchId },
})

beforeEach(async () => {
  const t = await createTestDb()
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
  await t.db
    .insert(deltas)
    .values([
      delta('d_voice', 4, { undoPayload: { state: { voice: 'hoarse' } } }),
      delta('d_lore', 3, { targetTable: 'lore', undoPayload: { title: 'Kael' } }),
      delta('d_traits', 2, { undoPayload: { state: { traits: ['brave'] } } }),
      delta('d_create', 1, { op: 'create' }),
      delta('d_fork', 2, { branchId: 'b2', undoPayload: { name: 'Kael' } }),
    ])
  expoDb = drizzle(expoOver(t.sqlite) as unknown as Parameters<typeof drizzle>[0], {
    schema: dbSchema,
  })
})

describe('readChainSnapshot (native)', () => {
  it('reads the chain oldest first, by field name, on its own table and branch', async () => {
    const { chain } = await readChainSnapshot(expoDb, kael())

    expect(chain.map((d) => [d.id, d.branchId, d.targetTable, d.logPosition])).toEqual([
      ['d_traits', 'b1', 'entities', 2],
      ['d_voice', 'b1', 'entities', 4],
    ])
    expect(chain[0].undoPayload).toEqual({ state: { traits: ['brave'] } })
    expect(chain[0]).not.toHaveProperty('target_table')
  })

  it("reads the requested branch's row with its JSON parsed", async () => {
    const { row } = await readChainSnapshot(expoDb, kael('char_kael', 'b2'))

    expect(row).toMatchObject({ id: 'char_kael', branchId: 'b2', name: 'Kael of the fork' })
    expect(row?.state).toEqual(STATE)
  })

  it('maps a row by field name', async () => {
    const { row } = await readChainSnapshot(expoDb, {
      ...kael('rel_1'),
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
    expect(await readChainSnapshot(expoDb, kael('char_gone'))).toEqual({ chain: [], row: null })
  })
})
