import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { updateEntryWorldTime, undoLastAction } from '@/lib/actions'
import { branches, deltas, stories, storyEntries, type EntryMetadata } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

afterEach(() => {
  entriesStore.__reset()
  generationStore.__reset()
  undoRedoStore.clear()
})

// Fresh objects per call: hydrate holds the rows it is given, so a shared
// literal would let one test's store patch leak into the next test's fixture.
function entryRows() {
  return [
    {
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply' as const,
      content: 'first',
      chapterId: null,
      metadata: { sceneEntities: [], currentLocationId: null, worldTime: 60 },
      createdAt: 1,
    },
    {
      id: 'e2',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply' as const,
      content: 'second',
      chapterId: null,
      metadata: {
        sceneEntities: ['ent1'],
        currentLocationId: null,
        worldTime: 120,
        summary: 's',
      },
      createdAt: 2,
    },
    {
      id: 'e3',
      branchId: 'b1',
      position: 3,
      kind: 'ai_reply' as const,
      content: 'third',
      chapterId: null,
      metadata: null,
      createdAt: 3,
    },
  ]
}

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

async function seed(db: TestDb) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  for (const row of entryRows()) await db.insert(storyEntries).values(row)
  entriesStore.hydrate('b1', entryRows())
}

async function storedMetadata(db: TestDb, id: string): Promise<EntryMetadata | null> {
  const [row] = await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, id)))
  return row.metadata
}

function branchDeltas(db: TestDb) {
  return db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
}

describe('updateEntryWorldTime', () => {
  it('writes exactly one op=update delta against the target and no other entry changes', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntryWorldTime('b1', 'e2', 45, ctx)
    expect(result.status).toBe('ok')

    const rows = await branchDeltas(db)
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({
      op: 'update',
      targetTable: 'story_entries',
      targetId: 'e2',
      // Survival anchor: rolling back a LATER turn must spare this edit.
      entryId: 'e2',
      source: 'user_edit',
    })
    // Column-keyed reversal payload carrying the pre-edit value.
    expect(rows[0].undoPayload).toEqual({ metadata: { worldTime: 120 } })

    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(45)
    expect((await storedMetadata(db, 'e1'))?.worldTime).toBe(60)
    expect(entriesStore.getEntries().get('e2')?.metadata?.worldTime).toBe(45)
    expect(entriesStore.getEntries().get('e1')?.metadata?.worldTime).toBe(60)
  })

  it('CTRL-Z (undoLastAction) reverses the edit and prunes the delta', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    expect((await updateEntryWorldTime('b1', 'e2', 45, ctx)).status).toBe('ok')
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(120)
    expect((await branchDeltas(db)).length).toBe(0)
    expect(entriesStore.getEntries().get('e2')?.metadata?.worldTime).toBe(120)
  })

  // 0 is the accept boundary of the storage invariant, not an edge to reject:
  // openings are always worldTime 0, and resetting an entry back to 0 undoes a
  // bad classifier advance or re-marks a flashback.
  it('accepts worldTime 0', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntryWorldTime('b1', 'e2', 0, ctx)
    expect(result.status).toBe('ok')

    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(0)
    expect((await branchDeltas(db)).length).toBe(1)
    expect(entriesStore.getEntries().get('e2')?.metadata?.worldTime).toBe(0)
  })

  it('suppresses a write that would not change the stored seconds', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    undoRedoStore.pushRedoGroup([])

    const result = await updateEntryWorldTime('b1', 'e2', 120, ctx)
    expect(result.status).toBe('ok')

    expect((await branchDeltas(db)).length).toBe(0)
    expect(await storedMetadata(db, 'e2')).toEqual({
      sceneEntities: ['ent1'],
      currentLocationId: null,
      worldTime: 120,
      summary: 's',
    })
    // The harm a no-op delta would do: applyDeltaAction clears the redo stack,
    // which is global rather than per-branch.
    expect(undoRedoStore.hasRedo()).toBe(true)
  })

  it('preserves sibling metadata fields on write', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    expect((await updateEntryWorldTime('b1', 'e2', 45, ctx)).status).toBe('ok')

    expect(await storedMetadata(db, 'e2')).toEqual({
      sceneEntities: ['ent1'],
      currentLocationId: null,
      worldTime: 45,
      summary: 's',
    })
  })

  it('rejects while generation is in flight', async () => {
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

    const result = await updateEntryWorldTime('b1', 'e2', 45, ctx)
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('in-flight-gated')
    expect((await branchDeltas(db)).length).toBe(0)
    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(120)
  })

  it('rejects a negative or non-integer worldTime', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    expect((await updateEntryWorldTime('b1', 'e2', -1, ctx)).status).toBe('rejected')
    expect((await updateEntryWorldTime('b1', 'e2', 1.5, ctx)).status).toBe('rejected')

    expect((await branchDeltas(db)).length).toBe(0)
    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(120)
  })

  it('rejects when the entry has no metadata or does not exist', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const noMetadata = await updateEntryWorldTime('b1', 'e3', 45, ctx)
    expect(noMetadata.status).toBe('rejected')
    expect(await storedMetadata(db, 'e3')).toBeNull()

    const missing = await updateEntryWorldTime('b1', 'nope', 45, ctx)
    expect(missing.status).toBe('rejected')
    if (missing.status === 'rejected') expect(missing.code).toBe('not-found')

    expect((await branchDeltas(db)).length).toBe(0)
  })
})
