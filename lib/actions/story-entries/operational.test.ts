import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaAction, type DbCtx } from '@/lib/actions'
import { branches, deltas, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore, generationStore } from '@/lib/stores'

import { getRollbackCounts, rollbackToEntry, updateStoryEntryContent } from './operational'

afterEach(() => {
  entriesStore.__reset()
  generationStore.__reset()
})

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(storyEntries).values({
    id: 'e1',
    branchId: 'b1',
    position: 1,
    kind: 'ai_reply',
    content: 'old',
    createdAt: 1,
  })
}

describe('updateStoryEntryContent', () => {
  it('mutates content, writes zero deltas, mirrors the store', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    entriesStore.hydrate('b1', [
      {
        id: 'e1',
        branchId: 'b1',
        position: 1,
        kind: 'ai_reply',
        content: 'old',
        chapterId: null,
        metadata: null,
        createdAt: 1,
      },
    ])

    const result = await updateStoryEntryContent('b1', 'e1', 'new text', ctx)
    expect(result.status).toBe('ok')

    const [row] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))
    expect(row.content).toBe('new text')
    expect((await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).length).toBe(0)
    expect(entriesStore.getById('e1')?.content).toBe('new text')
  })

  it('rejects while a hard-gate run is in flight', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    generationStore.startRun({
      runId: 'r1',
      kind: 'per-turn',
      gateBehavior: 'hard-gate',
      actionId: 'a',
      storyId: 's1',
      branchId: 'b1',
      abortController: new AbortController(),
      currentPhase: '',
      intermediates: {},
      terminal: Promise.resolve(),
      resolveTerminal: () => {},
    })
    const result = await updateStoryEntryContent('b1', 'e1', 'x', ctx)
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('in-flight-gated')
  })
})

// Fixture: opening (delta-exempt direct insert) + 3 turns, with one entity
// create + one entity update interleaved as the "world-state" deltas.
async function seedBranchWithTurns(db: Awaited<ReturnType<typeof createTestDb>>['db'], ctx: DbCtx) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  // Opening: wizard creation is delta-exempt — direct insert, no create delta.
  await db
    .insert(storyEntries)
    .values({ id: 'op', branchId: 'b1', position: 1, kind: 'opening', content: 'o', createdAt: 1 })
  const mkEntry = (id: string, position: number) => ({
    kind: 'createStoryEntry' as const,
    source: 'ai_classifier' as const,
    payload: {
      entry: {
        id,
        branchId: 'b1',
        position,
        kind: 'ai_reply' as const,
        content: id,
        metadata: { sceneEntities: [], currentLocationId: null, worldTime: position },
        createdAt: 1,
      },
    },
  })
  await applyDeltaAction(
    { action: mkEntry('t1', 2), actionId: 'turn1', branchId: 'b1', entryId: null },
    ctx,
  )
  await applyDeltaAction(
    { action: mkEntry('t2', 3), actionId: 'turn2', branchId: 'b1', entryId: null },
    ctx,
  )
  await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: 'ent_a',
            branchId: 'b1',
            kind: 'character',
            name: 'Aria',
            status: 'active',
            injectionMode: 'auto',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'turn2',
      branchId: 'b1',
      entryId: null,
    },
    ctx,
  )
  await applyDeltaAction(
    { action: mkEntry('t3', 4), actionId: 'turn3', branchId: 'b1', entryId: null },
    ctx,
  )
  await applyDeltaAction(
    {
      action: {
        kind: 'updateEntity',
        source: 'ai_classifier',
        payload: { branchId: 'b1', id: 'ent_a', patch: { name: 'Aria the Bold' } },
      },
      actionId: 'turn3',
      branchId: 'b1',
      entryId: null,
    },
    ctx,
  )
}

describe('rollbackToEntry', () => {
  it('counts and removes the clicked entry plus everything after it', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])

    // delete t2 removes t2 + t3 (2 entry-creates); world-state = ent_a create + ent_a update = 2.
    const counts = await getRollbackCounts('b1', 't2', ctx)
    expect(counts).toEqual({ entries: 2, chapters: 0, worldStateChanges: 2 })

    const result = await rollbackToEntry('b1', 't2', ctx)
    expect(result.status).toBe('ok')

    const remaining = (await db.select().from(storyEntries).where(eq(storyEntries.branchId, 'b1')))
      .map((r) => r.id)
      .sort()
    expect(remaining).toEqual(['op', 't1'])
    const lps = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).map(
      (r) => r.logPosition,
    )
    expect(lps).toEqual([1])
  })

  it('rejects rolling back the opening (floor)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    const result = await rollbackToEntry('b1', 'op', ctx)
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('rollback-floor')
  })

  it('rolling back to entry 1 leaves exactly the opening', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    await rollbackToEntry('b1', 't1', ctx)
    const remaining = (
      await db.select().from(storyEntries).where(eq(storyEntries.branchId, 'b1'))
    ).map((r) => r.id)
    expect(remaining).toEqual(['op'])
    const lps = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).map(
      (r) => r.logPosition,
    )
    expect(lps).toEqual([])
  })

  it('rollback past a content-edited entry still hard-deletes it', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])

    const deltaCountBefore = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1')))
      .length
    const edit = await updateStoryEntryContent('b1', 't3', 'user-edited prose', ctx)
    expect(edit.status).toBe('ok')
    const deltaCountAfter = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).length
    expect(deltaCountAfter).toBe(deltaCountBefore)

    const result = await rollbackToEntry('b1', 't2', ctx)
    expect(result.status).toBe('ok')
    const remaining = (await db.select().from(storyEntries).where(eq(storyEntries.branchId, 'b1')))
      .map((r) => r.id)
      .sort()
    expect(remaining).toEqual(['op', 't1'])
  })

  it('brackets the sweep with reversalInProgress (set then cleared)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])
    const spy = vi.spyOn(generationStore, 'setReversalInProgress')
    await rollbackToEntry('b1', 't2', ctx)
    expect(spy.mock.calls.map((c) => c[0])).toEqual([true, false])
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
    spy.mockRestore()
  })

  it('clears the reversal barrier even when the target is rejected', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    const result = await rollbackToEntry('b1', 'op', ctx)
    expect(result.status).toBe('rejected')
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })
})
