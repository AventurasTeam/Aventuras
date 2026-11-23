import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, stories } from '../schema'
import { createTestDb } from './test-db'

async function seedBranch(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })
}

describe('deltas table', () => {
  it('inserts and reads a delta with json undo_payload', async () => {
    const { db } = await createTestDb()
    await seedBranch(db)
    await db.insert(deltas).values({
      id: 'delta_1',
      branchId: 'b1',
      entryId: null,
      actionId: 'act_1',
      logPosition: 1,
      source: 'ai_classifier',
      targetTable: 'story_entries',
      targetId: 'entry_1',
      op: 'update',
      undoPayload: { worldTime: 0 },
      encodingVersion: 1,
      createdAt: 1,
    })
    const [row] = await db.select().from(deltas).where(eq(deltas.id, 'delta_1'))
    expect(row.undoPayload).toEqual({ worldTime: 0 })
    expect(row.encodingVersion).toBe(1)
  })

  it('rejects a duplicate (branch_id, log_position) via the unique backstop', async () => {
    const { db } = await createTestDb()
    await seedBranch(db)
    const base = {
      branchId: 'b1',
      entryId: null,
      actionId: 'act_1',
      logPosition: 1,
      source: 'ai_classifier' as const,
      targetTable: 'story_entries',
      targetId: 'e',
      op: 'create' as const,
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    }
    await db.insert(deltas).values({ id: 'delta_a', ...base })
    await expect(db.insert(deltas).values({ id: 'delta_b', ...base })).rejects.toThrow()
  })

  it('holds one delta id on two branches, and each (branch_id, id) once', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seedBranch(db)
    await db
      .insert(branches)
      .values({ id: 'b2', storyId: 's1', name: 'fork', parentBranchId: 'b1', createdAt: 2 })
    const insert = (branchId: string, logPosition: number) =>
      db
        .insert(deltas)
        .values({
          id: 'delta_1',
          branchId,
          entryId: null,
          actionId: 'act_1',
          logPosition,
          source: 'ai_classifier',
          targetTable: 'story_entries',
          targetId: 'entry_1',
          op: 'update',
          undoPayload: { worldTime: 0 },
          encodingVersion: 1,
          createdAt: 1,
        })
        .toSQL()

    await runInTransaction([insert('b1', 1), insert('b2', 1)])

    const rows = await db
      .select({ branchId: deltas.branchId })
      .from(deltas)
      .where(eq(deltas.id, 'delta_1'))
    expect(rows.map((r) => r.branchId).sort()).toEqual(['b1', 'b2'])
    await expect(runInTransaction([insert('b1', 2)])).rejects.toThrow(
      /UNIQUE constraint failed: deltas\.branch_id, deltas\.id/,
    )
  })

  it('rejects a delta whose branch does not exist (FK on)', async () => {
    const { db } = await createTestDb()
    await expect(
      db.insert(deltas).values({
        id: 'delta_x',
        branchId: 'missing',
        entryId: null,
        actionId: 'a',
        logPosition: 1,
        source: 'user_edit',
        targetTable: 'story_entries',
        targetId: 'e',
        op: 'create',
        undoPayload: null,
        encodingVersion: 1,
        createdAt: 1,
      }),
    ).rejects.toThrow()
  })
})
