import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { undoLastAction, updateEntrySceneFields, writeSystemEntry } from '@/lib/actions'
import {
  branches,
  deltas,
  entities,
  stories,
  storyEntries,
  type CharacterState,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

afterEach(() => {
  entriesStore.__reset()
  entitiesStore.__reset()
  generationStore.__reset()
  undoRedoStore.clear()
})

const LOC_A = 'loc_a'
const LOC_B = 'loc_b'

function character(id: string, locationId: string | null): NewEntity {
  return {
    id,
    branchId: 'b1',
    kind: 'character',
    name: id,
    description: '',
    status: 'active',
    injectionMode: 'auto',
    state: {
      visual: {},
      traits: [],
      drives: [],
      current_location_id: locationId,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: null,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function location(id: string): NewEntity {
  return {
    id,
    branchId: 'b1',
    kind: 'location',
    name: id,
    description: '',
    status: 'active',
    injectionMode: 'auto',
    state: { parent_location_id: null },
    createdAt: 1,
    updatedAt: 1,
  }
}

function entryRows() {
  return [
    {
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply' as const,
      content: 'first',
      chapterId: null,
      metadata: { sceneEntities: ['char_a'], currentLocationId: LOC_A, worldTime: 60 },
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
        sceneEntities: ['char_a', 'char_b'],
        currentLocationId: LOC_A,
        worldTime: 120,
        stateReport: {
          layer: 'piggyback_tagged_block' as const,
          sceneEntities: ['char_a', 'char_b'],
        },
      },
      createdAt: 2,
    },
  ]
}

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

async function seed(db: TestDb) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  for (const row of entryRows()) await db.insert(storyEntries).values(row)
  const rows = [
    character('char_a', LOC_A),
    character('char_b', LOC_A),
    location(LOC_A),
    location(LOC_B),
  ]
  for (const row of rows) await db.insert(entities).values(row)
  entriesStore.hydrate('b1', entryRows())
  entitiesStore.hydrate('b1', rows as never)
}

async function storedMetadata(db: TestDb, id: string) {
  const [row] = await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, id)))
  return row.metadata
}

async function entityState(db: TestDb, id: string): Promise<CharacterState> {
  const [row] = await db.select().from(entities).where(eq(entities.id, id))
  return row.state as CharacterState
}

describe('updateEntrySceneFields', () => {
  it('writes the absolute triple and leaves the report untouched', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a'], currentLocationId: LOC_A },
      ctx,
    )
    expect(result).toEqual({ status: 'ok' })

    const meta = await storedMetadata(db, 'e2')
    expect(meta?.sceneEntities).toEqual(['char_a'])
    // Immutable provenance: the report still says what the model said, so `layer`
    // stays trustworthy and `raw` stays meaningful.
    expect(meta?.stateReport?.sceneEntities).toEqual(['char_a', 'char_b'])
    expect(meta?.stateReport?.layer).toBe('piggyback_tagged_block')
  })

  it('accepts the narrative tail while a system entry sits above it', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await writeSystemEntry({ branchId: 'b1', content: 'the provider refused' }, ctx)

    // The gate is "last entry", and a failure banner is not one: refusing here would
    // make the scene editor go dead for as long as the banner shows.
    const result = await updateEntrySceneFields('b1', 'e2', { sceneEntities: ['char_a'] }, ctx)

    expect(result).toEqual({ status: 'ok' })
    expect((await storedMetadata(db, 'e2'))?.sceneEntities).toEqual(['char_a'])
  })

  it('applies the edit to world state via forward-diff', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a', 'char_b'], currentLocationId: LOC_B },
      ctx,
    )
    expect((await entityState(db, 'char_a')).current_location_id).toBe(LOC_B)
    expect((await entityState(db, 'char_b')).current_location_id).toBe(LOC_B)
  })

  // char_b is in this entry's ORIGINAL scene but not the previous entry's, so only
  // the three-way diff visits them at all.
  it('closes location tracking for a character the edit removed', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    await updateEntrySceneFields('b1', 'e2', { sceneEntities: ['char_a'] }, ctx)
    expect((await entityState(db, 'char_b')).lastSeenAt).toMatchObject({
      entryId: 'e1',
      locationId: LOC_A,
    })
  })

  it('does not demote a character removed from the scene', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    await updateEntrySceneFields('b1', 'e2', { sceneEntities: [] }, ctx)
    const [row] = await db.select().from(entities).where(eq(entities.id, 'char_b'))
    expect(row.status).toBe('active')
  })

  // Naming a staged entity in the scene is a strong signal of intentional
  // introduction — the same promotion the generation fold performs. The editor's own
  // copy promises it ("…and staged promotion").
  it('promotes a staged character the edit adds to the scene', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db.update(entities).set({ status: 'staged' }).where(eq(entities.id, 'char_b'))
    entitiesStore.hydrate('b1', [
      { ...character('char_a', LOC_A), status: 'active' },
      { ...character('char_b', LOC_A), status: 'staged' },
      location(LOC_A),
      location(LOC_B),
    ] as never)

    // A real change: char_a leaves, staged char_b stays named in the scene.
    await updateEntrySceneFields('b1', 'e2', { sceneEntities: ['char_b'] }, ctx)

    const [row] = await db.select().from(entities).where(eq(entities.id, 'char_b'))
    expect(row.status).toBe('active')
  })

  it('rejects an edit to a non-tail entry', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntrySceneFields('b1', 'e1', { sceneEntities: [] }, ctx)
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('not-tail-entry')
    // Nothing written.
    expect((await storedMetadata(db, 'e1'))?.sceneEntities).toEqual(['char_a'])
  })

  it('rejects while a generation holds the edit gate', async () => {
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

    const result = await updateEntrySceneFields('b1', 'e2', { sceneEntities: [] }, ctx)
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('in-flight-gated')
  })

  it('is a no-op when nothing changed', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_b', 'char_a'], currentLocationId: LOC_A },
      ctx,
    )
    expect(result.status).toBe('ok')
    expect(await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).toHaveLength(0)
  })

  // The list is a set, but the action takes an array and the stored value can already
  // hold a repeat emitted by the model. Left in, two promotes for one entity claim
  // entities.status twice and applyDeltaActionGroup rejects the whole edit.
  it('collapses a repeated id instead of letting the group reject it', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const staged = { ...character('char_staged', null), status: 'staged' as const }
    await db.insert(entities).values(staged)
    entitiesStore.hydrate('b1', [
      character('char_a', LOC_A),
      character('char_b', LOC_A),
      staged,
      location(LOC_A),
      location(LOC_B),
    ] as never)

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a', 'char_staged', 'char_staged'], currentLocationId: LOC_A },
      ctx,
    )

    expect(result.status).toBe('ok')
    expect((await storedMetadata(db, 'e2'))?.sceneEntities).toEqual(['char_a', 'char_staged'])
    const [promoted] = await db.select().from(entities).where(eq(entities.id, 'char_staged'))
    expect(promoted.status).toBe('active')
  })

  // sameMembers compares length first, so an unnormalised repeat of the stored scene
  // reads as a change and burns a delta — clearing the redo stack for nothing.
  it('treats a repeat of the current scene as a no-op', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a', 'char_b', 'char_a'], currentLocationId: LOC_A },
      ctx,
    )
    expect(result.status).toBe('ok')
    expect(await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).toHaveLength(0)
  })

  it('reverses cleanly, restoring both the scene and the derived state', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a'], currentLocationId: LOC_B },
      ctx,
    )
    expect((await entityState(db, 'char_a')).current_location_id).toBe(LOC_B)

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    const meta = await storedMetadata(db, 'e2')
    expect(meta?.sceneEntities).toEqual(['char_a', 'char_b'])
    expect(meta?.currentLocationId).toBe(LOC_A)
    expect((await entityState(db, 'char_a')).current_location_id).toBe(LOC_A)
  })

  // The metadata write and the tracking it implies are one transaction, so a tracking
  // rejection must leave the scene untouched rather than report total failure over an
  // edit that already landed.
  it('commits nothing when a tracking action is rejected', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    // In the working set but absent from the DB — what makes updateEntityLocationTracking
    // reject outright instead of returning the tolerated 'noop'.
    entitiesStore.hydrate('b1', [
      character('char_a', LOC_A),
      character('char_b', LOC_A),
      character('char_ghost', LOC_A),
      location(LOC_A),
      location(LOC_B),
    ] as never)

    const before = await storedMetadata(db, 'e2')

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a', 'char_ghost'], currentLocationId: LOC_B },
      ctx,
    )
    // Pinned: a rejection for any other reason would also commit nothing, and the
    // assertions below would pass without the group ever being exercised.
    expect(result).toMatchObject({ status: 'rejected', code: 'delta-failed' })

    // A committed metadata write here would make the failure unrecoverable: the retry
    // the copy invites matches the stored scene and returns ok without ever tracking.
    expect(await storedMetadata(db, 'e2')).toEqual(before)
    expect((await entityState(db, 'char_a')).current_location_id).not.toBe(LOC_B)
  })
})
