import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  deleteEntityRow,
  undoLastAction,
  updateEntrySceneFields,
  writeSystemEntry,
} from '@/lib/actions'
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

  // char_c left the scene at e2 and has been moved by hand since. An edit that doesn't
  // touch them must not re-anchor them at the previous entry's location.
  it('leaves a character who left at the tail where they were moved since', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const charC = character('char_c', LOC_B)
    await db.insert(entities).values(charC)
    entitiesStore.hydrate('b1', [
      character('char_a', LOC_A),
      character('char_b', LOC_A),
      charC,
      location(LOC_A),
      location(LOC_B),
    ] as never)
    await db
      .update(storyEntries)
      .set({
        metadata: { sceneEntities: ['char_a', 'char_c'], currentLocationId: LOC_A, worldTime: 60 },
      })
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))

    expect(await updateEntrySceneFields('b1', 'e2', { sceneEntities: ['char_a'] }, ctx)).toEqual({
      status: 'ok',
    })
    expect((await entityState(db, 'char_c')).current_location_id).toBe(LOC_B)
    expect((await entityState(db, 'char_b')).current_location_id).toBe(LOC_A)
  })

  // data-model.md → lastSeenAt: from the entry they were last in, e1 for char_a.
  it('closes location tracking for a character the edit removed', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    await updateEntrySceneFields('b1', 'e2', { sceneEntities: ['char_b'] }, ctx)
    expect((await entityState(db, 'char_a')).lastSeenAt).toMatchObject({
      entryId: 'e1',
      locationId: LOC_A,
    })
  })

  // char_b came in at e2, at LOC_B, so e1's LOC_A is a place they were never seen at; retired, it
  // can't be entered at all (data-model.md → LocationState shape).
  it("never writes a character the tail brought in into the previous entry's place", async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db.update(entities).set({ status: 'retired' }).where(eq(entities.id, LOC_A))
    await db
      .update(storyEntries)
      .set({
        metadata: { sceneEntities: ['char_a', 'char_b'], currentLocationId: LOC_B, worldTime: 120 },
      })
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e2')))
    const charB = character('char_b', LOC_B)
    await db.update(entities).set({ state: charB.state }).where(eq(entities.id, 'char_b'))
    entitiesStore.hydrate('b1', [
      character('char_a', LOC_B),
      charB,
      { ...location(LOC_A), status: 'retired' },
      location(LOC_B),
    ] as never)

    expect(await updateEntrySceneFields('b1', 'e2', { sceneEntities: ['char_a'] }, ctx)).toEqual({
      status: 'ok',
    })
    const state = await entityState(db, 'char_b')
    expect(state.current_location_id).toBe(LOC_B)
    expect(state.lastSeenAt).toBeNull()
  })

  // entry-card.md → Scene editor: promoted exactly as the generation fold promotes it, the place
  // the scene moves to included.
  it('promotes a staged place the edit moves the scene to', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db.update(entities).set({ status: 'staged' }).where(eq(entities.id, LOC_B))
    entitiesStore.hydrate('b1', [
      character('char_a', LOC_A),
      character('char_b', LOC_A),
      location(LOC_A),
      { ...location(LOC_B), status: 'staged' },
    ] as never)

    await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a', 'char_b'], currentLocationId: LOC_B },
      ctx,
    )
    const [row] = await db.select().from(entities).where(eq(entities.id, LOC_B))
    expect(row.status).toBe('active')
  })

  it('leaves a staged place the scene stays in staged', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db.update(entities).set({ status: 'staged' }).where(eq(entities.id, LOC_B))
    await db
      .update(storyEntries)
      .set({
        metadata: { sceneEntities: ['char_a', 'char_b'], currentLocationId: LOC_B, worldTime: 120 },
      })
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e2')))
    entitiesStore.hydrate('b1', [
      character('char_a', LOC_B),
      character('char_b', LOC_B),
      location(LOC_A),
      { ...location(LOC_B), status: 'staged' },
    ] as never)

    expect(
      await updateEntrySceneFields(
        'b1',
        'e2',
        { sceneEntities: ['char_a'], currentLocationId: LOC_B },
        ctx,
      ),
    ).toEqual({ status: 'ok' })
    expect((await storedMetadata(db, 'e2'))?.sceneEntities).toEqual(['char_a'])
    const [row] = await db.select().from(entities).where(eq(entities.id, LOC_B))
    expect(row.status).toBe('staged')
  })

  it('refuses a location id that names no place, writing nothing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a'], currentLocationId: 'char_b' },
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'not-a-location' })
    expect(await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).toHaveLength(0)
  })

  // As a scene already in a retired place keeps it: refusing would block every member-only edit.
  it('saves a member-only edit on a tail whose location names no place', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db
      .update(storyEntries)
      .set({
        metadata: {
          sceneEntities: ['char_a', 'char_b'],
          currentLocationId: 'loc_gone',
          worldTime: 120,
        },
      })
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e2')))

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a'], currentLocationId: 'loc_gone' },
      ctx,
    )
    expect(result).toEqual({ status: 'ok' })
    const meta = await storedMetadata(db, 'e2')
    expect(meta?.sceneEntities).toEqual(['char_a'])
    expect(meta?.currentLocationId).toBe('loc_gone')
    const before = (await entityState(db, 'char_a')).current_location_id
    expect(before).not.toBe('loc_gone')
  })

  it('writes no character to a tail location that names no place', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const stored = (await entityState(db, 'char_a')).current_location_id
    await db
      .update(storyEntries)
      .set({
        metadata: { sceneEntities: ['char_b'], currentLocationId: 'loc_gone', worldTime: 120 },
      })
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e2')))

    expect(
      await updateEntrySceneFields(
        'b1',
        'e2',
        { sceneEntities: ['char_a', 'char_b'], currentLocationId: 'loc_gone' },
        ctx,
      ),
    ).toEqual({ status: 'ok' })
    expect((await entityState(db, 'char_a')).current_location_id).toBe(stored)
  })

  // A delete clears the location from the tail only; the previous entry still names it,
  // and it is the previous entry that anchors a removed character's lastSeenAt.
  it('does not restore a deleted location to a character the edit removed', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)

    expect(await deleteEntityRow('b1', LOC_A, ctx)).toEqual({ status: 'ok' })
    expect((await entityState(db, 'char_b')).current_location_id).toBeNull()

    expect(await updateEntrySceneFields('b1', 'e2', { sceneEntities: [] }, ctx)).toEqual({
      status: 'ok',
    })
    expect((await entityState(db, 'char_a')).current_location_id).toBeNull()
    expect((await entityState(db, 'char_b')).current_location_id).toBeNull()
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
      interruptible: null,
      beforeTurn: false,
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

  // data-model.md → LocationState shape: nothing enters a retired place.
  it('refuses moving the scene into a retired place, writing nothing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const sunk = { ...location('loc_sunk'), status: 'retired' as const }
    await db.insert(entities).values(sunk)
    entitiesStore.hydrate('b1', [...entitiesStore.getEntities().values(), sunk] as never)

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a'], currentLocationId: 'loc_sunk' },
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'retired-place' })
    expect(await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).toHaveLength(0)
  })

  it('saves a scene already in a retired place when only its members change', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db.update(entities).set({ status: 'retired' }).where(eq(entities.id, LOC_A))
    entitiesStore.hydrate(
      'b1',
      (await db.select().from(entities).where(eq(entities.branchId, 'b1'))) as never,
    )

    const result = await updateEntrySceneFields(
      'b1',
      'e2',
      { sceneEntities: ['char_a'], currentLocationId: LOC_A },
      ctx,
    )
    expect(result).toEqual({ status: 'ok' })
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
