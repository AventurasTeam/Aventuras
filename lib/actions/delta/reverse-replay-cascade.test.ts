import { and, eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { branches, entities, stories, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { __resetRegistry, register } from './registry'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import { registerEntities } from '../entities/register'

// No shipped domain cascades an embeddable table today, so the engine's child arm
// needs a throwaway parent to be reachable at all.
const cascadeParents = sqliteTable('cascade_parents', {
  id: text('id').notNull(),
  branchId: text('branch_id').notNull(),
})

const KNIGHT: NewEntity = {
  id: 'char_1',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'a wandering knight',
  status: 'active',
  injectionMode: 'auto',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}

async function setup() {
  // vitest.setup.ts registered the real domains process-globally; reset so the
  // fixture domain lands in a registry holding only what this file needs.
  __resetRegistry()
  registerEntities()
  const { db, sqlite, runInTransaction } = await createTestDb()

  // cascade_parents lives outside the migrations.
  sqlite.exec(
    'CREATE TABLE cascade_parents (id TEXT NOT NULL, branch_id TEXT NOT NULL, PRIMARY KEY (branch_id, id))',
  )
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })

  register({
    table: 'cascade_parents',
    descriptor: {
      table: cascadeParents,
      idCol: cascadeParents.id,
      branchCol: cascadeParents.branchId,
    },
    columnSchemas: {},
    handlers: {},
    restoreCascade: (undoPayload) => ({
      children: [
        { table: 'entities', rows: undoPayload.entityChildren as Record<string, unknown>[] },
      ],
      cascadeKeys: ['entityChildren'],
    }),
  })

  return { db, ctx: { db, runInTransaction } }
}

describe('reverse-replay of a cascade whose children are embeddable', () => {
  it('re-dirties embedding_stale on restored child rows', async () => {
    const { db, ctx } = await setup()

    await reverseAndPruneDeltaRows(
      [
        {
          id: 'delta_1',
          branchId: 'b1',
          entryId: null,
          actionId: 'act_cascade',
          logPosition: 1,
          source: 'user_edit',
          targetTable: 'cascade_parents',
          targetId: 'p1',
          op: 'delete',
          undoPayload: {
            id: 'p1',
            branchId: 'b1',
            // Clean at delete time: it had been embedded and nothing touched it since.
            entityChildren: [{ ...KNIGHT, state: null, embeddingStale: 0 }],
          },
          encodingVersion: 1,
          createdAt: 1,
        },
      ],
      ctx,
    )

    const [row] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, 'b1'), eq(entities.id, 'char_1')))
    expect(row.name).toBe('Kael')
    expect(row.embeddingStale).toBe(1)
  })
})
