import { afterEach, describe, expect, it } from 'vitest'

import { branches, deltas, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore, undoRedoStore } from '@/lib/stores'

import { redoLastAction, undoLastAction } from './undo'

afterEach(() => {
  entriesStore.__reset()
  undoRedoStore.clear()
})

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(storyEntries).values({
    id: 'e_opening',
    branchId: 'b1',
    position: 1,
    kind: 'opening',
    content: 'once upon a time',
    createdAt: 1,
  })
  await db.insert(storyEntries).values({
    id: 'e_turn',
    branchId: 'b1',
    position: 2,
    kind: 'ai_reply',
    content: 'a reply',
    createdAt: 2,
  })
  await db.insert(deltas).values({
    id: 'd_turn',
    branchId: 'b1',
    actionId: 'act_turn',
    op: 'create',
    targetTable: 'story_entries',
    targetId: 'e_turn',
    entryId: null,
    source: 'ai_classifier',
    undoPayload: null,
    logPosition: 1,
    encodingVersion: 1,
    createdAt: 2,
  })
}

describe('undoLastAction / redoLastAction', () => {
  it('removes a turn (entry + deltas) and redo restores it', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    entriesStore.hydrate('b1', [
      {
        id: 'e_opening',
        branchId: 'b1',
        position: 1,
        kind: 'opening',
        content: 'once upon a time',
        chapterId: null,
        metadata: null,
        createdAt: 1,
      },
      {
        id: 'e_turn',
        branchId: 'b1',
        position: 2,
        kind: 'ai_reply',
        content: 'a reply',
        chapterId: null,
        metadata: null,
        createdAt: 2,
      },
    ])

    const result = await undoLastAction('b1', ctx)
    expect(result.status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeUndefined()

    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeDefined()

    // Proves redo re-inserted the delta row (not just the entry): a second undo
    // must find it again and remove the entry a second time.
    const secondUndo = await undoLastAction('b1', ctx)
    expect(secondUndo.status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeUndefined()
  })

  it('removes a real turn (user_action + ai_reply sharing one actionId) and redo restores both', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: 'e_opening',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'once upon a time',
      createdAt: 1,
    })
    await db.insert(storyEntries).values({
      id: 'e_user',
      branchId: 'b1',
      position: 2,
      kind: 'user_action',
      content: 'I open the door',
      createdAt: 2,
    })
    await db.insert(storyEntries).values({
      id: 'e_ai',
      branchId: 'b1',
      position: 3,
      kind: 'ai_reply',
      content: 'a reply',
      createdAt: 3,
    })
    // Both deltas share one actionId (submit-turn.ts's turnActionId contract) at
    // increasing log_positions — the user_action's create is the earlier one.
    await db.insert(deltas).values({
      id: 'd_user',
      branchId: 'b1',
      actionId: 'act_turn',
      op: 'create',
      targetTable: 'story_entries',
      targetId: 'e_user',
      entryId: null,
      source: 'user_edit',
      undoPayload: null,
      logPosition: 1,
      encodingVersion: 1,
      createdAt: 2,
    })
    await db.insert(deltas).values({
      id: 'd_ai',
      branchId: 'b1',
      actionId: 'act_turn',
      op: 'create',
      targetTable: 'story_entries',
      targetId: 'e_ai',
      entryId: null,
      source: 'ai_classifier',
      undoPayload: null,
      logPosition: 2,
      encodingVersion: 1,
      createdAt: 3,
    })
    entriesStore.hydrate('b1', [
      {
        id: 'e_opening',
        branchId: 'b1',
        position: 1,
        kind: 'opening',
        content: 'once upon a time',
        chapterId: null,
        metadata: null,
        createdAt: 1,
      },
      {
        id: 'e_user',
        branchId: 'b1',
        position: 2,
        kind: 'user_action',
        content: 'I open the door',
        chapterId: null,
        metadata: null,
        createdAt: 2,
      },
      {
        id: 'e_ai',
        branchId: 'b1',
        position: 3,
        kind: 'ai_reply',
        content: 'a reply',
        chapterId: null,
        metadata: null,
        createdAt: 3,
      },
    ])

    const result = await undoLastAction('b1', ctx)
    expect(result.status).toBe('ok')
    expect(entriesStore.getById('e_user')).toBeUndefined()
    expect(entriesStore.getById('e_ai')).toBeUndefined()
    expect(entriesStore.getById('e_opening')).toBeDefined()

    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('ok')
    expect(entriesStore.getById('e_user')).toBeDefined()
    expect(entriesStore.getById('e_ai')).toBeDefined()
  })

  it('rejects when there is nothing to undo', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    const result = await undoLastAction('b1', ctx)
    expect(result.status).toBe('rejected')
  })
})
