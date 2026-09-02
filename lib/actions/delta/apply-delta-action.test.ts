import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { branches, deltas, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { generationStore, resetAllStores, undoRedoStore } from '@/lib/stores'

import type { PipelineAction } from '../types'
import { applyDeltaAction, applyDeltaActionGroup } from './apply-delta-action'

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
}

describe('applyDeltaAction', () => {
  beforeEach(() => resetAllStores())
  afterEach(() => resetAllStores())

  it('op=create: writes target row + delta(undo_payload=null) + log_position 1', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    const res = await applyDeltaAction(
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
              createdAt: 1,
            },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      { db, runInTransaction },
    )
    expect(res).toEqual({ status: 'ok', logPosition: 1 })
    const [entry] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_1'))
    expect(entry.content).toBe('hi')
    const [delta] = await db.select().from(deltas).where(eq(deltas.actionId, 'act_1'))
    expect(delta.op).toBe('create')
    expect(delta.undoPayload).toBeNull()
    expect(delta.logPosition).toBe(1)
    expect(delta.source).toBe('ai_classifier')
  })

  it('clears the redo stack on a committed write, not on a rejection', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    const args = (id: string, branchId: string): Parameters<typeof applyDeltaAction>[0] => ({
      action: {
        kind: 'createStoryEntry',
        source: 'user_edit',
        payload: {
          entry: {
            id,
            branchId: 'b1',
            position: 9,
            kind: 'user_action',
            content: 'x',
            createdAt: 1,
          },
        },
      },
      actionId: 'act_redo',
      branchId,
      entryId: null,
    })

    undoRedoStore.pushRedoGroup([])
    // Branch mismatch rejects before any write — a rejection is not a new action.
    await applyDeltaAction(args('entry_r1', 'b-other'), { db, runInTransaction })
    expect(undoRedoStore.hasRedo()).toBe(true)

    await applyDeltaAction(args('entry_r1', 'b1'), { db, runInTransaction })
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('op=update: undo_payload captures pre-change metadata partial; log_position increments', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    await db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'hi',
      metadata: { sceneEntities: [], currentLocationId: 'loc_a', worldTime: 5 },
      createdAt: 1,
    })
    const res = await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: 'loc_b', worldTime: 5 },
          },
        },
        actionId: 'act_2',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      { db, runInTransaction },
    )
    expect(res.status).toBe('ok')
    const [entry] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_1'))
    expect((entry.metadata as { currentLocationId: string }).currentLocationId).toBe('loc_b')
    const [delta] = await db.select().from(deltas).where(eq(deltas.actionId, 'act_2'))
    expect(delta.op).toBe('update')
    // Column-keyed: { <column>: <pre-change partial> } — reverse-replay restores per column.
    expect(delta.undoPayload).toEqual({ metadata: { currentLocationId: 'loc_a' } })
  })

  it('op=create: rejects when the entry branch diverges from the delta branch', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    const res = await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b2',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              createdAt: 1,
            },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      { db, runInTransaction },
    )
    expect(res.status).toBe('rejected')
    expect(await db.select().from(storyEntries)).toHaveLength(0)
    expect(await db.select().from(deltas)).toHaveLength(0)
  })

  it('op=update: rejects when the target branch diverges from the delta branch', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    await db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'hi',
      metadata: { sceneEntities: [], currentLocationId: 'loc_a', worldTime: 5 },
      createdAt: 1,
    })
    const res = await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b2',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: 'loc_b', worldTime: 5 },
          },
        },
        actionId: 'act_2',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      { db, runInTransaction },
    )
    expect(res.status).toBe('rejected')
    const [entry] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_1'))
    expect((entry.metadata as { currentLocationId: string }).currentLocationId).toBe('loc_a')
    expect(await db.select().from(deltas)).toHaveLength(0)
  })

  it('rejects delta dispatch while a prose reversal is in progress', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    generationStore.setReversalInProgress(true)

    const result = await applyDeltaAction(
      {
        action: {
          kind: 'createEntity',
          source: 'user_edit',
          payload: {
            entry: {
              id: 'char_1',
              branchId: 'b1',
              kind: 'character',
              name: 'Kara',
              status: 'active',
              injectionMode: 'auto',
              createdAt: 1,
              updatedAt: 1,
            },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
      },
      { db, runInTransaction },
    )

    // Asserts `code`, not just the reason: it is the only field a caller can tell this
    // transient barrier from a failed write by; `reason` is free-form prose.
    expect(result).toEqual({
      status: 'rejected',
      code: 'reversal-in-progress',
      reason: 'prose reversal in progress',
    })
  })
})

describe('applyDeltaActionGroup', () => {
  beforeEach(() => resetAllStores())
  afterEach(() => resetAllStores())

  const createEntry = (id: string, position: number): PipelineAction => ({
    kind: 'createStoryEntry',
    source: 'user_edit',
    payload: {
      entry: { id, branchId: 'b1', position, kind: 'ai_reply', content: id, createdAt: 1 },
    },
  })

  const setMetadata = (id: string, worldTime: number): PipelineAction => ({
    kind: 'updateStoryEntryMetadata',
    source: 'user_edit',
    payload: { branchId: 'b1', id, metadata: { worldTime } },
  })

  it('commits every action under one actionId with sequential log positions', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)

    const res = await applyDeltaActionGroup(
      [createEntry('entry_1', 1), createEntry('entry_2', 2)],
      { actionId: 'act_1', branchId: 'b1' },
      { db, runInTransaction },
    )

    expect(res).toEqual({ status: 'ok' })
    const rows = await db.select().from(deltas).where(eq(deltas.actionId, 'act_1'))
    // MAX+1 is a subquery per statement, so batching must not collapse the positions.
    expect(rows.map((r) => r.logPosition).sort()).toEqual([1, 2])
    expect((await db.select().from(storyEntries)).length).toBe(2)
  })

  it('commits nothing when a later action rejects', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)

    const res = await applyDeltaActionGroup(
      [createEntry('entry_1', 1), setMetadata('entry_missing', 5)],
      { actionId: 'act_1', branchId: 'b1' },
      { db, runInTransaction },
    )

    expect(res.status).toBe('rejected')
    // The first action's row must not survive the second's refusal.
    expect((await db.select().from(storyEntries)).length).toBe(0)
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('refuses a group whose actions write one row column twice', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await applyDeltaActionGroup(
      [createEntry('entry_1', 1)],
      { actionId: 'act_0', branchId: 'b1' },
      ctx,
    )

    // Both handlers read pre-group state, so committing both would silently drop the
    // first writer's value rather than merge onto it.
    const res = await applyDeltaActionGroup(
      [setMetadata('entry_1', 10), setMetadata('entry_1', 20)],
      { actionId: 'act_1', branchId: 'b1' },
      ctx,
    )

    expect(res.status).toBe('rejected')
    const [entry] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_1'))
    expect(entry.metadata).toBeNull()
  })

  // Every handler runs before the transaction opens, so an action cannot depend on a row
  // an earlier action in the same group creates. Callers compose groups over rows that
  // already exist.
  it('cannot update a row created by an earlier action in the same group', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)

    const res = await applyDeltaActionGroup(
      [createEntry('entry_1', 1), setMetadata('entry_1', 7)],
      { actionId: 'act_1', branchId: 'b1' },
      { db, runInTransaction },
    )

    expect(res.status).toBe('rejected')
    expect((await db.select().from(storyEntries)).length).toBe(0)
  })
})
