import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  happenings,
  stories,
  storyEntries,
  type ClassifierStatus,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore, generationStore, happeningsStore, undoRedoStore } from '@/lib/stores'

import { isContentEditDelta } from './classifier-facts'
import { updateStoryEntryContent } from './operational'
import { redoLastAction, undoLastAction } from './undo'

afterEach(() => {
  entriesStore.__reset()
  generationStore.__reset()
  happeningsStore.__reset()
  undoRedoStore.clear()
})

const status = (processedThrough: number): ClassifierStatus => ({
  state: 'idle',
  lastSuccessAt: null,
  lastError: null,
  retryCount: 0,
  processedThrough,
})

// An opening plus one committed turn, so the log carries a create delta the undo arm
// would target if the content edit failed to become the head.
async function seedTurn(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db
    .insert(branches)
    .values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1, classifierStatus: status(2) })
  const rows = [
    { id: 'e_open', position: 1, kind: 'opening' as const, content: 'once upon a time' },
    { id: 'e_reply', position: 2, kind: 'ai_reply' as const, content: 'the courier rode north' },
  ].map((r) => ({ ...r, branchId: 'b1', createdAt: r.position }))
  await db.insert(storyEntries).values(rows)
  entriesStore.hydrate(
    'b1',
    rows.map((r) => ({ ...r, chapterId: null, metadata: null })),
  )
  await db.insert(deltas).values({
    id: 'd_turn',
    branchId: 'b1',
    actionId: 'act_turn',
    op: 'create',
    targetTable: 'story_entries',
    targetId: 'e_reply',
    entryId: null,
    source: 'ai_classifier',
    undoPayload: null,
    logPosition: 1,
    encodingVersion: 1,
    createdAt: 2,
  })
}

async function seedFactFrom(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  entryId: string,
  logPosition: number,
) {
  await db.insert(happenings).values({
    id: 'hap_derived',
    branchId: 'b1',
    title: `derived from ${entryId}`,
    occurredAtEntryId: entryId,
    createdAt: 3,
    updatedAt: 3,
  })
  await db.insert(deltas).values({
    id: 'd_fact',
    branchId: 'b1',
    actionId: 'act_classifier',
    op: 'create',
    targetTable: 'happenings',
    targetId: 'hap_derived',
    entryId,
    source: 'periodic_classifier',
    undoPayload: null,
    logPosition,
    encodingVersion: 1,
    createdAt: 3,
  })
}

describe('undo of a content edit', () => {
  it('restores the prose and leaves the turn standing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)

    await updateStoryEntryContent('b1', 'e_reply', 'the courier turned back', ctx)
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    const rows = await db.select().from(storyEntries).where(eq(storyEntries.branchId, 'b1'))
    // Without the edit's own delta the head group is the turn, and undo deletes it.
    expect(rows.map((r) => r.id).sort()).toEqual(['e_open', 'e_reply'])
    expect(rows.find((r) => r.id === 'e_reply')?.content).toBe('the courier rode north')
    expect(entriesStore.getById('e_reply')?.content).toBe('the courier rode north')

    const remaining = await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
    expect(remaining.map((d) => d.id)).toEqual(['d_turn'])
  })

  it('reverses the facts derived from the edited prose and clamps the watermark', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)

    await updateStoryEntryContent('b1', 'e_reply', 'the courier turned back', ctx)
    // A pass that read the edited prose before the undo: its facts describe text the
    // undo is about to remove.
    await seedFactFrom(db, 'e_reply', 3)
    await db
      .update(branches)
      .set({ classifierStatus: status(2) })
      .where(eq(branches.id, 'b1'))

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    expect(await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))).toEqual([])
    const remaining = await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
    expect(remaining.map((d) => d.id)).toEqual(['d_turn'])
    const [branch] = await db
      .select({ s: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.s?.processedThrough).toBe(1)
  })

  it('snapshots only the edit for redo, not the facts it reversed', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)

    await updateStoryEntryContent('b1', 'e_reply', 'the courier turned back', ctx)
    await seedFactFrom(db, 'e_reply', 3)
    await db
      .update(branches)
      .set({ classifierStatus: status(2) })
      .where(eq(branches.id, 'b1'))

    await undoLastAction('b1', ctx)

    // Replaying the fact would re-insert a row the next pass re-derives anyway, and
    // fight the redo arm's own invalidation.
    const snapshot = undoRedoStore.peekRedoGroup()
    expect(snapshot).toHaveLength(1)
    expect(isContentEditDelta(snapshot![0].delta)).toBe(true)
  })

  it('redo restores the edited prose and re-inserts the delta', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)

    await updateStoryEntryContent('b1', 'e_reply', 'the courier turned back', ctx)
    await undoLastAction('b1', ctx)
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')

    const [row] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'e_reply'))
    expect(row.content).toBe('the courier turned back')
    expect(entriesStore.getById('e_reply')?.content).toBe('the courier turned back')
    const remaining = await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
    expect(remaining.filter(isContentEditDelta)).toHaveLength(1)
  })

  it('redo reverses the facts derived from the prose it replaces, and re-clamps', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)

    await updateStoryEntryContent('b1', 'e_reply', 'the courier turned back', ctx)
    await undoLastAction('b1', ctx)
    // A retry timer firing between the undo and the redo: this pass read the restored
    // original, so its facts describe prose the redo is about to replace.
    await seedFactFrom(db, 'e_reply', 5)
    await db
      .update(branches)
      .set({ classifierStatus: status(2) })
      .where(eq(branches.id, 'b1'))

    expect((await redoLastAction('b1', ctx)).status).toBe('ok')

    expect(await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))).toEqual([])
    expect(happeningsStore.getHappenings().has('hap_derived')).toBe(false)
    const [branch] = await db
      .select({ s: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.s?.processedThrough).toBe(1)
  })

  it('redoes over a fact delta holding the log position the undo freed', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)

    await updateStoryEntryContent('b1', 'e_reply', 'the courier turned back', ctx)
    const [edit] = await db.select().from(deltas).where(eq(deltas.source, 'user_edit'))
    await undoLastAction('b1', ctx)
    // What a real pass does: MAX+1 lands on the position the prune just freed, so the
    // redo's re-insert and the reversal of this row contend for one unique key.
    await seedFactFrom(db, 'e_reply', edit.logPosition)
    await db
      .update(branches)
      .set({ classifierStatus: status(2) })
      .where(eq(branches.id, 'b1'))

    expect((await redoLastAction('b1', ctx)).status).toBe('ok')

    expect(await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))).toEqual([])
    const remaining = await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
    expect(remaining.map((d) => d.id).sort()).toEqual(['d_turn', edit.id].sort())
  })

  it('a redo that restores nothing reverses no facts', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)
    await seedFactFrom(db, 'e_reply', 5)

    // applyRedo writes nothing for a snapshot carrying no row, so reversing facts for
    // it would be pure loss.
    undoRedoStore.pushRedoGroup([
      {
        delta: {
          id: 'd_phantom',
          branchId: 'b1',
          actionId: 'act_phantom',
          op: 'update',
          targetTable: 'story_entries',
          targetId: 'e_reply',
          entryId: 'e_reply',
          source: 'user_edit',
          undoPayload: { content: 'gone' },
          logPosition: 9,
          encodingVersion: 1,
          createdAt: 9,
        },
        rowBeforeUndo: null,
      },
    ])

    expect((await redoLastAction('b1', ctx)).status).toBe('ok')
    expect(await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))).toHaveLength(1)
  })

  it('reverses nothing and clamps nothing below the head turn', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTurn(db)
    // Anchored to the opening, which sits under the head turn.
    await seedFactFrom(db, 'e_open', 2)

    await updateStoryEntryContent('b1', 'e_open', 'a different beginning', ctx)
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    const [row] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'e_open'))
    expect(row.content).toBe('once upon a time')
    expect(await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))).toHaveLength(1)
    const [branch] = await db
      .select({ s: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.s?.processedThrough).toBe(2)
  })
})
