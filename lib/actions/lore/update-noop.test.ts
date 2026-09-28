import { describe, expect, it } from 'vitest'

import { branches, deltas, lore, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { applyDeltaAction } from '../delta/apply-delta-action'

describe('updateLore', () => {
  it('logs only the columns that changed, and a no-op when none did', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db
      .insert(lore)
      .values({
        id: 'lore_1',
        branchId: 'b1',
        title: 'Vael',
        body: 'A city.',
        injectionMode: 'auto',
        createdAt: 1,
        updatedAt: 1,
      })
    const update = (patch: Record<string, unknown>) =>
      applyDeltaAction(
        {
          action: {
            kind: 'updateLore',
            source: 'user_edit',
            payload: { branchId: 'b1', id: 'lore_1', patch },
          },
          actionId: 'a',
          branchId: 'b1',
        },
        ctx,
      )

    expect(await update({ title: 'Vael' })).toMatchObject({ status: 'rejected', code: 'noop' })
    await update({ title: 'Vael', body: 'A port.' })
    const [row] = await db.select().from(deltas)
    expect(row.undoPayload).toEqual({ body: 'A city.' })
  })
})
