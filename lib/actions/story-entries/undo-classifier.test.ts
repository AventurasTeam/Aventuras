import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  happeningAwareness,
  happenings,
  stories,
  storyEntries,
  type ClassifierStatus,
  type Delta,
  type EntryMetadata,
  type Happening,
  type HappeningAwareness,
  type StoryEntry,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  entriesStore,
  generationStore,
  happeningAwarenessStore,
  happeningsStore,
  undoRedoStore,
} from '@/lib/stores'

import { redoLastAction, undoLastAction } from './undo'

afterEach(() => {
  entriesStore.__reset()
  generationStore.__reset()
  happeningsStore.__reset()
  happeningAwarenessStore.__reset()
  undoRedoStore.clear()
})

const status = (processedThrough: number): ClassifierStatus => ({
  state: 'idle',
  lastSuccessAt: null,
  lastError: null,
  retryCount: 0,
  processedThrough,
})

const entry = (
  id: string,
  position: number,
  kind: StoryEntry['kind'],
  metadata: EntryMetadata | null = null,
): StoryEntry => ({
  id,
  branchId: 'b1',
  position,
  kind,
  content: `${id} content`,
  chapterId: null,
  metadata,
  createdAt: position,
})

const delta = (
  id: string,
  logPosition: number,
  actionId: string,
  source: Delta['source'],
  targetTable: string,
  targetId: string,
  op: Delta['op'],
  entryId: string | null = null,
  undoPayload: Record<string, unknown> | null = null,
): Delta => ({
  id,
  branchId: 'b1',
  actionId,
  op,
  targetTable,
  targetId,
  entryId,
  source,
  undoPayload,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
})

const hap = (id: string, title: string, occurredAtEntryId: string | null = null): Happening => ({
  id,
  branchId: 'b1',
  title,
  description: null,
  category: null,
  icon: null,
  temporal: null,
  occurredAtEntryId,
  commonKnowledge: 0,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
})

const AWARENESS_B: HappeningAwareness = {
  id: 'haw_b1',
  branchId: 'b1',
  happeningId: 'hap_b1',
  characterId: 'char_kael',
  learnedAtEntryId: 'e_b',
  decayResistance: null,
  retrievalCount: 0,
  source: 'witnessed firsthand',
}

const B_METADATA: EntryMetadata = { sceneEntities: [], currentLocationId: null, worldTime: 5 }

// AC1's log: turn A, classifier pass anchored to A, turn B (with a piggyback
// metadata delta), classifier pass with facts anchored to both A and B.
async function seedAc1() {
  const { db, runInTransaction } = await createTestDb()
  const ctx = { db, runInTransaction }
  const entries = [
    entry('e_opening', 1, 'opening'),
    entry('e_a', 2, 'ai_reply'),
    entry('e_b', 3, 'ai_reply', B_METADATA),
  ]
  const haps = [
    hap('hap_a1', 'fact about A (pass 1)', 'e_a'),
    hap('hap_a2', 'fact about A (pass 2)', 'e_a'),
    hap('hap_b1', 'fact about B (pass 2)', 'e_b'),
  ]
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({
    id: 'b1',
    storyId: 's1',
    name: 'm',
    createdAt: 1,
    classifierStatus: status(3),
  })
  await db.insert(storyEntries).values(entries)
  await db.insert(happenings).values(haps)
  await db.insert(happeningAwareness).values(AWARENESS_B)
  await db
    .insert(deltas)
    .values([
      delta('d_a_create', 1, 'act_a', 'ai_classifier', 'story_entries', 'e_a', 'create'),
      delta(
        'd_c1_hap',
        2,
        'act_c1',
        'periodic_classifier',
        'happenings',
        'hap_a1',
        'create',
        'e_a',
      ),
      delta('d_b_create', 3, 'act_b', 'ai_classifier', 'story_entries', 'e_b', 'create'),
      delta(
        'd_b_meta',
        4,
        'act_b',
        'piggyback_tagged_block',
        'story_entries',
        'e_b',
        'update',
        'e_b',
        { metadata: null },
      ),
      delta(
        'd_c2_hapA',
        5,
        'act_c2',
        'periodic_classifier',
        'happenings',
        'hap_a2',
        'create',
        'e_a',
      ),
      delta(
        'd_c2_hapB',
        6,
        'act_c2',
        'periodic_classifier',
        'happenings',
        'hap_b1',
        'create',
        'e_b',
      ),
      delta(
        'd_c2_awB',
        7,
        'act_c2',
        'periodic_classifier',
        'happening_awareness',
        'haw_b1',
        'create',
        'e_b',
      ),
    ])
  entriesStore.hydrate('b1', entries)
  happeningsStore.hydrate('b1', haps)
  happeningAwarenessStore.hydrate('b1', [AWARENESS_B])
  return { db, ctx }
}

describe('AC1 — undo of turn B spares facts anchored to surviving turn A', () => {
  it('reverses B, its piggyback delta, and B-anchored classifier facts; spares A-anchored facts; clamps; redo restores the unit', async () => {
    const { db, ctx } = await seedAc1()

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    // B and everything anchored to it is gone.
    expect(entriesStore.getById('e_b')).toBeUndefined()
    expect((await db.select().from(storyEntries).where(eq(storyEntries.id, 'e_b'))).length).toBe(0)
    expect((await db.select().from(happenings).where(eq(happenings.id, 'hap_b1'))).length).toBe(0)
    expect(
      (await db.select().from(happeningAwareness).where(eq(happeningAwareness.id, 'haw_b1')))
        .length,
    ).toBe(0)

    // A and its facts — including the LAGGING pass-2 fact committed above B — survive.
    expect(entriesStore.getById('e_a')).toBeDefined()
    expect((await db.select().from(happenings).where(eq(happenings.id, 'hap_a1'))).length).toBe(1)
    expect((await db.select().from(happenings).where(eq(happenings.id, 'hap_a2'))).length).toBe(1)

    // Surviving facts keep their delta rows; the reversed suffix is pruned.
    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).map(
      (d) => d.id,
    )
    expect(remaining.sort()).toEqual(['d_a_create', 'd_c1_hap', 'd_c2_hapA'])

    // processedThrough clamps below B (position 3 → 2).
    const [branch] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(branch.classifierStatus?.processedThrough).toBe(2)

    // Redo restores the whole unit — entry (with its piggyback metadata),
    // B-anchored facts, and their delta rows — without touching the watermark.
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')
    expect(entriesStore.getById('e_b')).toBeDefined()
    const [eB] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'e_b'))
    expect(eB.metadata).toEqual(B_METADATA)
    expect((await db.select().from(happenings).where(eq(happenings.id, 'hap_b1'))).length).toBe(1)
    expect(
      (await db.select().from(happeningAwareness).where(eq(happeningAwareness.id, 'haw_b1')))
        .length,
    ).toBe(1)
    const restored = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).map(
      (d) => d.id,
    )
    expect(restored.sort()).toEqual(
      [
        'd_a_create',
        'd_b_create',
        'd_b_meta',
        'd_c1_hap',
        'd_c2_hapA',
        'd_c2_hapB',
        'd_c2_awB',
      ].sort(),
    )
    const [branchAfterRedo] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(branchAfterRedo.classifierStatus?.processedThrough).toBe(2)
  })
})
