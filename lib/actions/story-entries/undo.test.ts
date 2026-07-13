import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { branches, deltas, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { redoLastAction, undoLastAction } from './undo'
import { DeltaReplayError } from '../delta/reverse-replay'

afterEach(() => {
  entriesStore.__reset()
  generationStore.__reset()
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

function hydrateOpeningAndTurn() {
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

  it('does not pop the redo stack when applyRedo throws (retry still works)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    expect(undoRedoStore.hasRedo()).toBe(true)

    // Re-insert the row undo deleted so applyRedo's forward INSERT hits a PK
    // conflict inside its transaction and throws — a genuine, recoverable
    // failure (no mocking of the redo primitive).
    await db.insert(storyEntries).values({
      id: 'e_turn',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply',
      content: 'a reply',
      createdAt: 2,
    })
    await expect(redoLastAction('b1', ctx)).rejects.toThrow()

    // Snapshot survives the failure: nothing was popped, redo is still pending.
    expect(undoRedoStore.hasRedo()).toBe(true)

    // Clear the conflict; the still-present snapshot now redoes successfully.
    await db.delete(storyEntries).where(eq(storyEntries.id, 'e_turn'))
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeDefined()
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('rejects redo whose snapshot belongs to a different branch, leaving the stack', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    expect(undoRedoStore.hasRedo()).toBe(true)

    const wrong = await redoLastAction('b_other', ctx)
    expect(wrong.status).toBe('rejected')
    if (wrong.status === 'rejected') expect(wrong.reason).toMatch(/branch/i)

    // The mismatch must not consume branch b1's own redo.
    expect(undoRedoStore.hasRedo()).toBe(true)
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeDefined()
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('preserves the redo snapshot when reversal commits but post-commit store sync fails', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()

    // The reversal + prune tx commits, then the patcher throws → committed:true.
    const patchSpy = vi.spyOn(entriesStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })
    await expect(undoLastAction('b1', ctx)).rejects.toBeInstanceOf(DeltaReplayError)
    patchSpy.mockRestore()

    // The DB change is real and committed: the delta row was pruned.
    expect((await db.select().from(deltas).where(eq(deltas.id, 'd_turn'))).length).toBe(0)
    // ...and redo capability was preserved despite the thrown store-sync error.
    expect(undoRedoStore.hasRedo()).toBe(true)
  })

  it('rejects undo/redo while generation blocks user edits', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()
    generationStore.setReversalInProgress(true)

    const undoResult = await undoLastAction('b1', ctx)
    expect(undoResult.status).toBe('rejected')
    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('rejected')
  })

  it('brackets the sweep with reversalInProgress (set then cleared)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()
    const spy = vi.spyOn(generationStore, 'setReversalInProgress')

    await undoLastAction('b1', ctx)
    expect(spy.mock.calls.map((c) => c[0])).toEqual([true, false])
    expect(generationStore.getTxState().reversalInProgress).toBe(false)

    spy.mockClear()
    await redoLastAction('b1', ctx)
    expect(spy.mock.calls.map((c) => c[0])).toEqual([true, false])
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
    spy.mockRestore()
  })

  it('rejects undo/redo when the branch is not the one loaded in entriesStore', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // Loaded branch is 'b2', not 'b1' — simulates a stale branchId mid branch-switch.
    entriesStore.hydrate('b2', [])

    const undoResult = await undoLastAction('b1', ctx)
    expect(undoResult.status).toBe('rejected')

    hydrateOpeningAndTurn()
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    entriesStore.hydrate('b2', [])
    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('rejected')
  })
})
