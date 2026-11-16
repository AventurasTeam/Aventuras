import { afterEach, describe, expect, it } from 'vitest'

import { branches, deltas, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore, generationStore, undoRedoStore, type RunState } from '@/lib/stores'

import { updateStoryEntryContent } from './operational'
import { readUndoTarget } from './undo-target'

afterEach(() => {
  entriesStore.__reset()
  generationStore.__reset()
  undoRedoStore.clear()
})

const ENTRY = { contentTokens: null, chapterId: null, metadata: null }

async function seeded() {
  const { db, runInTransaction } = await createTestDb()
  const ctx = { db, runInTransaction }
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  const rows = [
    {
      id: 'e_opening',
      branchId: 'b1',
      position: 1,
      kind: 'opening' as const,
      content: 'once',
      createdAt: 1,
    },
    {
      id: 'e_turn',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply' as const,
      content: 'a reply',
      createdAt: 2,
    },
  ]
  for (const row of rows) await db.insert(storyEntries).values(row)
  entriesStore.hydrate(
    'b1',
    rows.map((row) => ({ ...ENTRY, ...row })),
  )
  return { db, ctx }
}

async function logTurn(db: Awaited<ReturnType<typeof seeded>>['db']) {
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

describe('readUndoTarget', () => {
  it('reads nothing on a branch with nothing to undo', async () => {
    const { ctx } = await seeded()
    expect(await readUndoTarget('b1', ctx)).toBeNull()
  })

  it("reads the head group with its entries' positions", async () => {
    const { db, ctx } = await seeded()
    await logTurn(db)

    const read = await readUndoTarget('b1', ctx)

    expect(read?.actionId).toBe('act_turn')
    expect(read?.deltas.map((d) => d.id)).toEqual(['d_turn'])
    expect(read?.entryPositions).toEqual({ e_turn: 2 })
  })

  it('reads a newer edit over the turn, at the entry it anchors on', async () => {
    const { db, ctx } = await seeded()
    await logTurn(db)
    expect(await updateStoryEntryContent('b1', 'e_turn', 'edited', ctx)).toEqual({ status: 'ok' })

    const read = await readUndoTarget('b1', ctx)

    expect(read?.actionId).not.toBe('act_turn')
    expect(read?.deltas).toHaveLength(1)
    expect(read?.deltas[0].source).toBe('user_edit')
    expect(read?.entryPositions).toEqual({ e_turn: 2 })
  })

  async function logCloseWork(db: Awaited<ReturnType<typeof seeded>>['db']) {
    await db.insert(deltas).values({
      id: 'd_close',
      branchId: 'b1',
      actionId: 'act_close',
      op: 'create',
      targetTable: 'lore',
      targetId: 'lore_1',
      entryId: 'e_turn',
      source: 'chapter_close',
      undoPayload: null,
      logPosition: 2,
      encodingVersion: 1,
      createdAt: 3,
    })
  }

  it('reads the positions of the entries a group anchors on', async () => {
    const { db, ctx } = await seeded()
    await logTurn(db)
    await logCloseWork(db)

    const read = await readUndoTarget('b1', ctx)

    expect(read?.actionId).toBe('act_close')
    expect(read?.entryPositions).toEqual({ e_turn: 2 })
  })

  // Undo interrupts a running close, reversing it first, so the target is the turn beneath it.
  it('passes over the rows of a close still running on the branch', async () => {
    const { db, ctx } = await seeded()
    await logTurn(db)
    await logCloseWork(db)
    const closing: RunState = {
      runId: 'run_close',
      kind: 'chapter-close',
      gateBehavior: 'hard-gate',
      actionId: 'act_close',
      storyId: 's1',
      branchId: 'b1',
      abortController: new AbortController(),
      currentPhase: 'agent',
      intermediates: {},
      terminal: new Promise<void>(() => {}),
      resolveTerminal: () => {},
      interruptible: 'close',
      beforeTurn: false,
    }
    generationStore.startRun(closing)

    expect((await readUndoTarget('b1', ctx))?.actionId).toBe('act_turn')
  })
})
