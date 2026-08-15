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
import { applyDeltaAction } from '../delta/apply-delta-action'

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

describe('AC2 — classifier group at the literal head', () => {
  it('steps over it, targets the turn beneath, and the suffix sweep carries the classifier group down', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    const entries = [
      entry('e_opening', 1, 'opening'),
      entry('e_a', 2, 'ai_reply'),
      entry('e_b', 3, 'ai_reply'),
    ]
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(storyEntries).values(entries)
    await db.insert(happenings).values(hap('hap_b1', 'fact about B', 'e_b'))
    await db.insert(deltas).values([
      delta('d_a_create', 1, 'act_a', 'ai_classifier', 'story_entries', 'e_a', 'create'),
      delta('d_b_create', 2, 'act_b', 'ai_classifier', 'story_entries', 'e_b', 'create'),
      // The literal head is a classifier group — never an undo target.
      delta('d_c_hapB', 3, 'act_c', 'periodic_classifier', 'happenings', 'hap_b1', 'create', 'e_b'),
    ])
    entriesStore.hydrate('b1', entries)
    happeningsStore.hydrate('b1', [hap('hap_b1', 'fact about B', 'e_b')])

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    // The turn beneath the classifier group was the target…
    expect(entriesStore.getById('e_b')).toBeUndefined()
    expect(entriesStore.getById('e_a')).toBeDefined()
    // …and the head classifier group was carried down with the suffix.
    expect((await db.select().from(happenings).where(eq(happenings.id, 'hap_b1'))).length).toBe(0)
    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).map(
      (d) => d.id,
    )
    expect(remaining).toEqual(['d_a_create'])
  })
})

describe('AC3 — user field-edit above a classifier group', () => {
  it('reverses only the edit group; the classifier group stays put', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    const entries = [entry('e_opening', 1, 'opening'), entry('e_a', 2, 'ai_reply')]
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(storyEntries).values(entries)
    await db.insert(happenings).values(hap('hap_a1', 'Edited title', 'e_a'))
    await db.insert(deltas).values([
      delta('d_a_create', 1, 'act_a', 'ai_classifier', 'story_entries', 'e_a', 'create'),
      delta('d_c_hapA', 2, 'act_c', 'periodic_classifier', 'happenings', 'hap_a1', 'create', 'e_a'),
      // User edits the happening's title afterwards — a non-prose group at the head.
      delta('d_edit', 3, 'act_edit', 'user_edit', 'happenings', 'hap_a1', 'update', null, {
        title: 'Original title',
      }),
    ])
    entriesStore.hydrate('b1', entries)
    happeningsStore.hydrate('b1', [hap('hap_a1', 'Edited title', 'e_a')])

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')

    // Group path: only the edit reversed — the row survives with its old title.
    const [row] = await db.select().from(happenings).where(eq(happenings.id, 'hap_a1'))
    expect(row.title).toBe('Original title')
    expect(entriesStore.getById('e_a')).toBeDefined()
    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).map(
      (d) => d.id,
    )
    expect(remaining.sort()).toEqual(['d_a_create', 'd_c_hapA'])

    // Redo re-applies the single-delta frame.
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')
    const [redone] = await db.select().from(happenings).where(eq(happenings.id, 'hap_a1'))
    expect(redone.title).toBe('Edited title')
  })
})

describe('AC6 — undo floor in a wizard-created story', () => {
  it('rejects in a fresh story (no deltas) and stops at the opening after the only turn is undone', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    // Wizard commit: opening baked in, delta log empty.
    await db.insert(storyEntries).values(entry('e_opening', 1, 'opening'))
    entriesStore.hydrate('b1', [entry('e_opening', 1, 'opening')])

    expect((await undoLastAction('b1', ctx)).status).toBe('rejected')

    // First turn arrives, then gets undone — the log empties again, floor holds.
    await db.insert(storyEntries).values(entry('e_t1', 2, 'user_action'))
    await db
      .insert(deltas)
      .values(delta('d_t1', 1, 'act_t1', 'user_edit', 'story_entries', 'e_t1', 'create'))
    entriesStore.hydrate('b1', [entry('e_opening', 1, 'opening'), entry('e_t1', 2, 'user_action')])

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    expect(entriesStore.getById('e_t1')).toBeUndefined()
    expect((await undoLastAction('b1', ctx)).status).toBe('rejected')
    expect(entriesStore.getById('e_opening')).toBeDefined()
  })
})

describe('AC4 — CTRL-Z with a classifier run mid-flight', () => {
  it('aborts the run and holds the sweep until its terminal resolves', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    const entries = [entry('e_opening', 1, 'opening'), entry('e_t1', 2, 'ai_reply')]
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(storyEntries).values(entries)
    await db
      .insert(deltas)
      .values(delta('d_t1', 1, 'act_t1', 'ai_classifier', 'story_entries', 'e_t1', 'create'))
    entriesStore.hydrate('b1', entries)

    let resolveTerminal!: () => void
    const terminal = new Promise<void>((r) => {
      resolveTerminal = r
    })
    const abortController = new AbortController()
    let aborted = false
    abortController.signal.addEventListener('abort', () => {
      aborted = true
    })
    // A no-gate classifier run: does not block user edits, so undo proceeds
    // and must drain it via the C3 bracket.
    generationStore.startRun({
      runId: 'run_c',
      kind: 'periodic-classifier',
      gateBehavior: 'no-gate',
      actionId: 'act_c',
      storyId: 's1',
      branchId: 'b1',
      abortController,
      currentPhase: '',
      intermediates: {},
      terminal,
      resolveTerminal,
    })

    const done = undoLastAction('b1', ctx)
    // The bracket aborts the doomed run synchronously, before any sweep work…
    expect(aborted).toBe(true)
    // …and the sweep waits for the terminal, not merely a microtask turn: an
    // unbracketed sweep would have finished within this flush (in-memory SQLite,
    // no real I/O), so the entry still standing is the barrier's own evidence.
    await new Promise((r) => setTimeout(r, 0))
    expect(entriesStore.getById('e_t1')).toBeDefined()

    resolveTerminal()
    expect((await done).status).toBe('ok')
    expect(entriesStore.getById('e_t1')).toBeUndefined()
  })
})

describe('AC5 — redo of a classifier-processed turn tolerates re-derivation', () => {
  it('keeps the watermark clamped after redo; a re-deriving pass upserts awareness cleanly and only duplicates the happening', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    const entries = [entry('e_opening', 1, 'opening'), entry('e_b', 2, 'ai_reply')]
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({
      id: 'b1',
      storyId: 's1',
      name: 'm',
      createdAt: 1,
      classifierStatus: status(2),
    })
    await db.insert(storyEntries).values(entries)
    await db.insert(happenings).values(hap('hap_b1', 'fact about B', 'e_b'))
    await db.insert(happeningAwareness).values(AWARENESS_B)
    await db
      .insert(deltas)
      .values([
        delta('d_b_create', 1, 'act_b', 'ai_classifier', 'story_entries', 'e_b', 'create'),
        delta(
          'd_c_hap',
          2,
          'act_c',
          'periodic_classifier',
          'happenings',
          'hap_b1',
          'create',
          'e_b',
        ),
        delta(
          'd_c_aw',
          3,
          'act_c',
          'periodic_classifier',
          'happening_awareness',
          'haw_b1',
          'create',
          'e_b',
        ),
      ])
    entriesStore.hydrate('b1', entries)
    happeningsStore.hydrate('b1', [hap('hap_b1', 'fact about B', 'e_b')])
    happeningAwarenessStore.hydrate('b1', [AWARENESS_B])

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')

    // Redo does NOT restore processedThrough — the clamp survives, so the next
    // pass re-covers B (data-model.md → Survival anchor, redo tolerance).
    const [branch] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(branch.classifierStatus?.processedThrough).toBe(1)

    // The re-deriving pass, at the write-path seam: a fresh happening row for
    // the same fact is a tolerated duplicate (cleaned at M5 chapter-close dedup)…
    const dupHap = await applyDeltaAction(
      {
        action: {
          kind: 'createHappening',
          source: 'periodic_classifier',
          payload: {
            entry: { ...hap('hap_b1_dup', 'fact about B', 'e_b'), createdAt: 9, updatedAt: 9 },
          },
        },
        actionId: 'act_rederive',
        branchId: 'b1',
        entryId: 'e_b',
      },
      ctx,
    )
    expect(dupHap.status).toBe('ok')

    // …while the awareness re-derive hits the natural-key upsert: it merges
    // into the redo-restored row instead of violating haw_natural_uniq.
    const mergeAw = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: {
            branchId: 'b1',
            characterId: 'char_kael',
            happeningId: 'hap_b1',
            source: 'retold by Jorin',
          },
        },
        actionId: 'act_rederive',
        branchId: 'b1',
        entryId: 'e_b',
      },
      ctx,
    )
    expect(mergeAw.status).toBe('ok')

    // A field-less re-derive is the other tolerated shape: a rejection, not a throw.
    const bareAw = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: { branchId: 'b1', characterId: 'char_kael', happeningId: 'hap_b1' },
        },
        actionId: 'act_rederive',
        branchId: 'b1',
        entryId: 'e_b',
      },
      ctx,
    )
    expect(bareAw.status).toBe('rejected')

    // Exactly one awareness row for the natural key — absorbed, not duplicated.
    const awRows = await db
      .select()
      .from(happeningAwareness)
      .where(eq(happeningAwareness.happeningId, 'hap_b1'))
    expect(awRows.length).toBe(1)
    expect(awRows[0].source).toBe('retold by Jorin')
    // Two happening rows for the fact — the tolerated duplicate.
    const hapRows = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(hapRows.map((h) => h.id).sort()).toEqual(['hap_b1', 'hap_b1_dup'])
  })
})
