import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { applyDeltaAction } from './apply-delta-action'
import { reverseAndPruneDeltaRows, reverseReplayDeltas } from './reverse-replay'

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
}

describe('reverseReplayDeltas', () => {
  it('reverses create + update in DESC order, returns count', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // delta 1: create entry with metadata worldTime 5
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    // delta 2 (same action): update metadata worldTime -> 9
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 9 },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )

    const count = await reverseReplayDeltas('act_1', ctx)
    expect(count).toBe(2)
    // update reversed first (worldTime back to 5), then create reversed (row deleted)
    const rows = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(rows.length).toBe(0)
    // and no residual deltas applied wrong: assert the deltas still exist (framework consumes the primitive; deletion of delta rows is a data-model decision, not this primitive)
    expect((await db.select().from(deltas).where(eq(deltas.actionId, 'act_1'))).length).toBe(2)
  })

  it('returns 0 for an actionId with no deltas', async () => {
    const { db, runInTransaction } = await createTestDb()
    expect(await reverseReplayDeltas('act_none', { db, runInTransaction })).toBe(0)
  })

  it('reverses a single update with the row surviving (positive restore)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // create under a SEPARATE action so the row survives reversing the update action
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_keep',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 9 },
          },
        },
        actionId: 'act_rev',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    const count = await reverseReplayDeltas('act_rev', ctx)
    expect(count).toBe(1)
    const [entry] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(entry).toBeDefined() // row survives (create was a different action)
    expect(entry.metadata).toEqual({ sceneEntities: [], currentLocationId: null, worldTime: 5 })
  })

  it('reverses two same-row updates with DISJOINT sub-keys without clobbering', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_keep',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    // update A: worldTime 5 -> 7
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 7 },
          },
        },
        actionId: 'act_rev',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    // update B: currentLocationId null -> 'loc_z' (disjoint sub-key)
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: 'loc_z', worldTime: 7 },
          },
        },
        actionId: 'act_rev',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    const count = await reverseReplayDeltas('act_rev', ctx)
    expect(count).toBe(2)
    const [entry] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    // BOTH sub-keys restored to their pre-act_rev state — no clobber
    expect(entry.metadata).toEqual({ sceneEntities: [], currentLocationId: null, worldTime: 5 })
  })
})

describe('reverseAndPruneDeltaRows', () => {
  it('commits extra ops even when there are no delta rows to reverse', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const count = await reverseAndPruneDeltaRows([], ctx, [
      { sql: `UPDATE branches SET name = ? WHERE id = ?`, params: ['renamed', 'b1'] },
    ])
    expect(count).toBe(0)
    const [branch] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(branch.name).toBe('renamed')
  })
})
