import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, entities, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { applyRedo, snapshotForRedo } from './redo'

describe('snapshotForRedo / applyRedo', () => {
  it('round-trips an update delta: captures pre-undo state, then restores it on redo', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(entities).values({
      id: 'ent_1',
      branchId: 'b1',
      kind: 'character',
      name: 'Aria',
      description: 'a knight',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })

    const deltaRow = {
      id: 'd1',
      branchId: 'b1',
      actionId: 'act_1',
      op: 'update' as const,
      targetTable: 'entities',
      targetId: 'ent_1',
      entryId: null,
      source: 'user_edit' as const,
      undoPayload: { name: 'Old Name' },
      logPosition: 1,
      encodingVersion: 1,
      createdAt: Date.now(),
    }

    // snapshotForRedo must run BEFORE the undo reversal, capturing current ('Aria').
    const snapshot = await snapshotForRedo([deltaRow], ctx)

    // Simulate the undo having applied the delta's undo_payload (name -> 'Old Name').
    await db.update(entities).set({ name: 'Old Name' }).where(eq(entities.id, 'ent_1'))

    // Redo must restore the pre-undo state ('Aria'), not the undo_payload's value.
    await applyRedo(snapshot, ctx)
    const [row] = await db.select().from(entities).where(eq(entities.id, 'ent_1'))
    expect(row?.name).toBe('Aria')
  })
})
