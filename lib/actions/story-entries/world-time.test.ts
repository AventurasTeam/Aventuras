import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { applyDeltaAction, undoLastAction, updateEntryWorldTime } from '@/lib/actions'
import { MAX_WORLD_TIME_SECONDS } from '@/lib/calendar'
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
  await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'alt', createdAt: 1 })
  for (const row of entryRows()) await db.insert(storyEntries).values(row)
  entriesStore.hydrate('b1', entryRows())
}

function storedEntry(db: TestDb, id: string, branchId = 'b1') {
  return db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
    .then((rows) => rows[0])
}

async function storedMetadata(db: TestDb, id: string): Promise<EntryMetadata | null> {
  return (await storedEntry(db, id)).metadata
}

function branchDeltas(db: TestDb, branchId = 'b1') {
  return db.select().from(deltas).where(eq(deltas.branchId, branchId))
}

describe('updateEntryWorldTime', () => {
  it('writes exactly one op=update delta against the target and no other entry changes', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    undoRedoStore.pushRedoGroup([])

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
    // Contrast with the suppression test below: a real write does clear the
    // global redo stack, which is why suppressing a no-op write matters.
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('rejects an entry read through the wrong branch', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntryWorldTime('b2', 'e1', 45, ctx)
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('not-found')

    expect((await branchDeltas(db)).length).toBe(0)
    expect((await branchDeltas(db, 'b2')).length).toBe(0)
    expect((await storedMetadata(db, 'e1'))?.worldTime).toBe(60)
  })

  it('CTRL-Z (undoLastAction) reverses only the edit, sparing the prior turn', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // A prior turn's create delta at a lower log_position. Without it the log
    // holds no story_entries create at all, so selectUndoTarget's `turn` branch
    // is unreachable and "one CTRL-Z undoes just the edit" holds by construction.
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'e4',
              branchId: 'b1',
              position: 4,
              kind: 'ai_reply',
              content: 'prior turn',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 200 },
              createdAt: 4,
            },
          },
        },
        actionId: 'act_prior_turn',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )

    expect((await updateEntryWorldTime('b1', 'e2', 45, ctx)).status).toBe('ok')
    expect((await branchDeltas(db)).length).toBe(2)
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(120)
    expect(entriesStore.getEntries().get('e2')?.metadata?.worldTime).toBe(120)

    // The prior turn is untouched: its delta and the entry it created survive.
    const remaining = await branchDeltas(db)
    expect(remaining.length).toBe(1)
    expect(remaining[0]).toMatchObject({ op: 'create', targetId: 'e4' })
    expect(await storedEntry(db, 'e4')).toBeDefined()
    expect(entriesStore.getEntries().get('e4')).toBeDefined()
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

  // Two Saves landing during one in-flight write: unserialized, both reads
  // observe the pre-edit seconds, both dispatch, and each mints its own
  // actionId — so the user gets two CTRL-Z steps for one conceptual edit, the
  // second silently consuming the undo of whatever came before. Both promises
  // are created before either is awaited, so the calls genuinely overlap.
  it('collapses two concurrent edits of the same entry into one delta', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const first = updateEntryWorldTime('b1', 'e2', 45, ctx)
    const second = updateEntryWorldTime('b1', 'e2', 45, ctx)
    expect((await Promise.all([first, second])).map((r) => r.status)).toEqual(['ok', 'ok'])

    expect((await branchDeltas(db)).length).toBe(1)
    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(45)

    // The criterion the count stands in for: one CTRL-Z restores the pre-edit
    // value with nothing left behind it.
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(120)
    expect((await branchDeltas(db)).length).toBe(0)
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

    const negative = await updateEntryWorldTime('b1', 'e2', -1, ctx)
    expect(negative.status).toBe('rejected')
    if (negative.status === 'rejected') expect(negative.code).toBe('invalid-world-time')
    expect((await updateEntryWorldTime('b1', 'e2', 1.5, ctx)).status).toBe('rejected')

    expect((await branchDeltas(db)).length).toBe(0)
    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(120)
  })

  // The reader's format walk is linear in the resolved top-tier value, so an
  // unbounded worldTime freezes the first paint rather than rendering wrong.
  it('rejects a worldTime past the render-cost ceiling but accepts the ceiling itself', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const tooBig = await updateEntryWorldTime('b1', 'e2', MAX_WORLD_TIME_SECONDS + 1, ctx)
    expect(tooBig.status).toBe('rejected')
    if (tooBig.status === 'rejected') expect(tooBig.code).toBe('invalid-world-time')
    expect((await branchDeltas(db)).length).toBe(0)

    expect((await updateEntryWorldTime('b1', 'e2', MAX_WORLD_TIME_SECONDS, ctx)).status).toBe('ok')
    expect((await storedMetadata(db, 'e2'))?.worldTime).toBe(MAX_WORLD_TIME_SECONDS)
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
