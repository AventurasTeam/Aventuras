import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaAction, DeltaReplayError, reverseReplayDeltas, type DbCtx } from '@/lib/actions'
import {
  branches,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  storyEntries,
  type ClassifierStatus,
  type Delta,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import {
  entriesStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  undoRedoStore,
} from '@/lib/stores'

import { isContentEditDelta } from './classifier-facts'
import { getRollbackCounts, rollbackToEntry, updateStoryEntryContent } from './operational'
import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '../delta/branch-write-lock'

afterEach(() => {
  __resetBranchWriteLocks()
  entriesStore.__reset()
  generationStore.__reset()
  happeningAwarenessStore.__reset()
  happeningInvolvementsStore.__reset()
  happeningsStore.__reset()
  undoRedoStore.clear()
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

// A content edit's delta id is generated, so the seeded-id lists below partition it
// out rather than trying to name it.
function seededDeltaIds(rows: Delta[]): string[] {
  return rows
    .filter((d) => !isContentEditDelta(d))
    .map((d) => d.id)
    .sort()
}

function contentDeltas(rows: Delta[]): Delta[] {
  return rows.filter(isContentEditDelta)
}

describe('updateStoryEntryContent', () => {
  it('mutates content, logs one anchored user_edit delta, mirrors the store', async () => {
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
    expect(entriesStore.getById('e1')?.content).toBe('new text')

    const logged = await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      source: 'user_edit',
      targetTable: 'story_entries',
      targetId: 'e1',
      // Survival anchor: a rollback above this entry must spare the delta.
      entryId: 'e1',
      op: 'update',
      undoPayload: { content: 'old' },
      encodingVersion: 1,
    })
  })

  it('assigns the content delta a log position above every survivor', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)

    await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    const rows = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))) as Delta[]
    const [added] = contentDeltas(rows)
    const survivors = rows.filter((d) => !isContentEditDelta(d)).map((d) => d.logPosition)
    // selectUndoTarget walks from the head, so an edit that did not land there would
    // leave CTRL-Z reaching past it to the turn beneath.
    expect(added.logPosition).toBeGreaterThan(Math.max(...survivors))
  })

  it('computes the content delta log position against the post-prune log', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedHeadTurn(db)

    // Editing the head turn's origin prunes the facts at positions 2 and 3, leaving
    // position 1. MAX+1 therefore reuses 2; ordering the insert before the prune
    // would yield 4.
    await updateStoryEntryContent('b1', 'e2', 'rewritten action', ctx)

    const rows = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))) as Delta[]
    expect(contentDeltas(rows)[0].logPosition).toBe(2)
  })

  it('clears the redo stack on success (an edit is a new unrelated action)', async () => {
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
    undoRedoStore.pushRedoGroup([])
    expect(undoRedoStore.hasRedo()).toBe(true)

    await updateStoryEntryContent('b1', 'e1', 'new text', ctx)
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('clears the redo stack even when the store patch after the commit throws', async () => {
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
    undoRedoStore.pushRedoGroup([])
    const patch = vi.spyOn(entriesStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    await expect(updateStoryEntryContent('b1', 'e1', 'new text', ctx)).rejects.toThrow(
      'store sync boom',
    )
    patch.mockRestore()

    expect(undoRedoStore.hasRedo()).toBe(false)
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
    // Nothing is reversed here: this fixture's world-state deltas are ai_classifier
    // with a null anchor, so they are never in the invalidation set.
    expect(deltaCountAfter).toBe(deltaCountBefore + 1)

    const result = await rollbackToEntry('b1', 't2', ctx)
    expect(result.status).toBe('ok')
    const remaining = (await db.select().from(storyEntries).where(eq(storyEntries.branchId, 'b1')))
      .map((r) => r.id)
      .sort()
    expect(remaining).toEqual(['op', 't1'])
  })

  it('spares a content edit on an entry the rollback keeps', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])

    // t1 survives a rollback to t3, so its edit must survive with it — the delta sits
    // at the log head, so only its entry_id anchor keeps the sweep off it.
    await updateStoryEntryContent('b1', 't1', 'kept edit', ctx)
    expect((await rollbackToEntry('b1', 't3', ctx)).status).toBe('ok')

    const [row] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 't1')))
    expect(row.content).toBe('kept edit')
  })

  it('leaves a content edit out of the world-state count', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])

    await updateStoryEntryContent('b1', 't3', 'edited prose', ctx)

    // t3 is inside the window, so its delta is swept — but the entries line already
    // reports that loss (rollback-confirm.md).
    const counts = await getRollbackCounts('b1', 't2', ctx)
    expect(counts).toEqual({ entries: 2, chapters: 0, worldStateChanges: 2 })
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

  it('clamps the classifier watermark to position(B) - 1 in the sweep transaction', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])
    await db
      .update(branches)
      .set({
        classifierStatus: {
          state: 'idle',
          lastSuccessAt: null,
          lastError: null,
          retryCount: 0,
          processedThrough: 4,
        },
      })
      .where(eq(branches.id, 'b1'))

    // t2 is position 3 and is itself the first removed entry.
    const result = await rollbackToEntry('b1', 't2', ctx)
    expect(result.status).toBe('ok')
    const [row] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(row.classifierStatus?.processedThrough).toBe(2)
  })

  it('leaves a watermark already below the clamp untouched', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])
    await db
      .update(branches)
      .set({
        classifierStatus: {
          state: 'idle',
          lastSuccessAt: null,
          lastError: null,
          retryCount: 0,
          processedThrough: 1,
        },
      })
      .where(eq(branches.id, 'b1'))

    // Asserted first: a rejected rollback runs no clamp, so the watermark would
    // read 1 for the wrong reason and the test would prove nothing.
    const result = await rollbackToEntry('b1', 't2', ctx)
    expect(result.status).toBe('ok')
    const [row] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(row.classifierStatus?.processedThrough).toBe(1)
  })

  it('clears the redo stack on success (a rollback is a new unrelated action)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])
    undoRedoStore.pushRedoGroup([])
    expect(undoRedoStore.hasRedo()).toBe(true)

    const result = await rollbackToEntry('b1', 't2', ctx)
    expect(result.status).toBe('ok')
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('clears the redo stack when the rollback commits but its store sync throws', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])
    undoRedoStore.pushRedoGroup([])
    const patch = vi.spyOn(entriesStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    const error: unknown = await rollbackToEntry('b1', 't2', ctx).catch((e: unknown) => e)
    patch.mockRestore()

    expect(error).toBeInstanceOf(DeltaReplayError)
    expect((error as DeltaReplayError).committed).toBe(true)
    expect(undoRedoStore.hasRedo()).toBe(false)
  })
})

// A branch whose classifier has already covered the tail: entry e2 carries a
// happening with an involvement and an awareness row, all anchored to it.
const classifierStatus = (processedThrough: number): ClassifierStatus => ({
  state: 'idle',
  lastSuccessAt: null,
  lastError: null,
  retryCount: 0,
  processedThrough,
})

const classifierDelta = (
  id: string,
  logPosition: number,
  targetTable: string,
  targetId: string,
  entryId: string,
): Delta => ({
  id,
  branchId: 'b1',
  actionId: 'act_classifier',
  op: 'create',
  targetTable,
  targetId,
  entryId,
  source: 'periodic_classifier',
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
})

async function seedClassifiedTail(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({
    id: 'b1',
    storyId: 's1',
    name: 'm',
    createdAt: 1,
    classifierStatus: classifierStatus(2),
  })
  const entries = [
    {
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply' as const,
      content: 'a',
      createdAt: 1,
    },
    {
      id: 'e2',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply' as const,
      content: 'old',
      createdAt: 2,
    },
  ]
  await db.insert(storyEntries).values(entries)
  entriesStore.hydrate(
    'b1',
    entries.map((e) => ({ ...e, chapterId: null, metadata: null })),
  )
  await db.insert(happenings).values([
    {
      id: 'hap_2',
      branchId: 'b1',
      title: 'derived from e2',
      occurredAtEntryId: 'e2',
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: 'hap_1',
      branchId: 'b1',
      title: 'derived from e1',
      occurredAtEntryId: 'e1',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  await db
    .insert(happeningInvolvements)
    .values({ id: 'hinv_2', branchId: 'b1', happeningId: 'hap_2', entityId: 'char_k', role: null })
  await db.insert(happeningAwareness).values({
    id: 'haw_2',
    branchId: 'b1',
    happeningId: 'hap_2',
    characterId: 'char_k',
    learnedAtEntryId: 'e2',
    decayResistance: null,
    retrievalCount: 0,
    source: 'witnessed firsthand',
  })
  await db.insert(deltas).values([
    classifierDelta('d_hap1', 1, 'happenings', 'hap_1', 'e1'),
    classifierDelta('d_hap2', 2, 'happenings', 'hap_2', 'e2'),
    classifierDelta('d_hinv2', 3, 'happening_involvements', 'hinv_2', 'e2'),
    classifierDelta('d_haw2', 4, 'happening_awareness', 'haw_2', 'e2'),
    {
      ...classifierDelta('d_meta2', 5, 'story_entries', 'e2', 'e2'),
      id: 'd_meta2',
      source: 'piggyback_tagged_block',
      op: 'update',
      undoPayload: { metadata: null },
    },
  ])
}

// A head turn proper: an ai_reply tail over its user_action origin, each with one
// classifier-derived happening, plus an earlier entry whose facts must never move.
async function seedHeadTurn(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({
    id: 'b1',
    storyId: 's1',
    name: 'm',
    createdAt: 1,
    classifierStatus: classifierStatus(3),
  })
  const entries = [
    { id: 'e1', position: 1, kind: 'ai_reply' as const, content: 'a' },
    { id: 'e2', position: 2, kind: 'user_action' as const, content: 'act' },
    { id: 'e3', position: 3, kind: 'ai_reply' as const, content: 'reply' },
  ].map((e) => ({ ...e, branchId: 'b1', createdAt: e.position }))
  await db.insert(storyEntries).values(entries)
  entriesStore.hydrate(
    'b1',
    entries.map((e) => ({ ...e, chapterId: null, metadata: null })),
  )
  await db.insert(happenings).values(
    (['e1', 'e2', 'e3'] as const).map((entryId, i) => ({
      id: `hap_${i + 1}`,
      branchId: 'b1',
      title: `derived from ${entryId}`,
      occurredAtEntryId: entryId,
      createdAt: i + 1,
      updatedAt: i + 1,
    })),
  )
  await db
    .insert(deltas)
    .values(
      (['e1', 'e2', 'e3'] as const).map((entryId, i) =>
        classifierDelta(`d_hap${i + 1}`, i + 1, 'happenings', `hap_${i + 1}`, entryId),
      ),
    )
}

// The same head turn under a failed follow-up: the turn reversed its own user_action
// and left the failure singleton above the reply, which is still the branch's real tail.
async function seedHeadTurnUnderFailure(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({
    id: 'b1',
    storyId: 's1',
    name: 'm',
    createdAt: 1,
    classifierStatus: classifierStatus(2),
  })
  const entries = [
    { id: 'e1', position: 1, kind: 'user_action' as const, content: 'act' },
    { id: 'e2', position: 2, kind: 'ai_reply' as const, content: 'reply' },
    { id: 'e3', position: 3, kind: 'system' as const, content: 'generation failed' },
  ].map((e) => ({ ...e, branchId: 'b1', createdAt: e.position }))
  await db.insert(storyEntries).values(entries)
  entriesStore.hydrate(
    'b1',
    entries.map((e) => ({ ...e, chapterId: null, metadata: null })),
  )
  await db.insert(happenings).values(
    (['e1', 'e2'] as const).map((entryId, i) => ({
      id: `hap_${i + 1}`,
      branchId: 'b1',
      title: `derived from ${entryId}`,
      occurredAtEntryId: entryId,
      createdAt: i + 1,
      updatedAt: i + 1,
    })),
  )
  await db
    .insert(deltas)
    .values(
      (['e1', 'e2'] as const).map((entryId, i) =>
        classifierDelta(`d_hap${i + 1}`, i + 1, 'happenings', `hap_${i + 1}`, entryId),
      ),
    )
}

describe('updateStoryEntryContent classifier invalidation', () => {
  it('clears the redo stack when the edit commits but its reversal store sync throws', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    undoRedoStore.pushRedoGroup([])
    const patch = vi.spyOn(happeningsStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    const error: unknown = await updateStoryEntryContent('b1', 'e2', 'new', ctx).catch(
      (e: unknown) => e,
    )
    patch.mockRestore()

    expect(error).toBeInstanceOf(DeltaReplayError)
    expect((error as DeltaReplayError).committed).toBe(true)
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('takes link rows anchored to a different entry down with their happening', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    // Awareness anchors to the turn that narrated the learning, which can sit either
    // side of the happening's own provenance entry — so anchor-scoped reversal alone
    // would delete hap_2 and leave this row pointing at nothing.
    await db.insert(happeningAwareness).values({
      id: 'haw_early',
      branchId: 'b1',
      happeningId: 'hap_2',
      characterId: 'char_m',
      learnedAtEntryId: 'e1',
      decayResistance: null,
      retrievalCount: 0,
      source: 'told by Jorin',
    })
    await db
      .insert(deltas)
      .values([classifierDelta('d_haw_early', 6, 'happening_awareness', 'haw_early', 'e1')])

    expect((await updateStoryEntryContent('b1', 'e2', 'new', ctx)).status).toBe('ok')

    expect(await db.select().from(happeningAwareness)).toEqual([])
    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))) as Delta[]
    expect(seededDeltaIds(remaining)).toEqual(['d_hap1', 'd_meta2'])
    expect(contentDeltas(remaining)).toHaveLength(1)
  })

  it("takes the user's later edit of a happening down with it, leaving no delta behind", async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    await db.update(happenings).set({ title: 'renamed in Plot' }).where(eq(happenings.id, 'hap_2'))
    await db.insert(deltas).values({
      ...classifierDelta('d_rename', 6, 'happenings', 'hap_2', 'e2'),
      actionId: 'act_user',
      source: 'user_edit',
      op: 'update',
      entryId: null,
      undoPayload: { title: 'derived from e2' },
    })

    expect((await updateStoryEntryContent('b1', 'e2', 'new', ctx)).status).toBe('ok')

    expect((await db.select().from(happenings)).map((h) => h.id)).toEqual(['hap_1'])
    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))) as Delta[]
    expect(seededDeltaIds(remaining)).toEqual(['d_hap1', 'd_meta2'])
  })

  it('spares an entity the pass introduced, whose references sit outside the anchor set', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    await db.insert(entities).values({
      id: 'char_new',
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 2,
      updatedAt: 2,
    })
    await db.insert(deltas).values([
      classifierDelta('d_ent_create', 6, 'entities', 'char_new', 'e2'),
      // A status flip on the same entity is an update: undoing it restores a prior
      // value and dangles nothing, so it must still go.
      {
        ...classifierDelta('d_ent_flip', 7, 'entities', 'char_new', 'e2'),
        id: 'd_ent_flip',
        op: 'update' as const,
        undoPayload: { status: 'staged' },
      },
    ])

    await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    const rows = await db.select().from(entities).where(eq(entities.branchId, 'b1'))
    expect(rows.map((e) => e.id)).toEqual(['char_new'])
    expect(rows[0].status).toBe('staged')
    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))) as Delta[]
    expect(seededDeltaIds(remaining)).toEqual(['d_ent_create', 'd_hap1', 'd_meta2'])
    expect(contentDeltas(remaining)).toHaveLength(1)
  })

  it('leaves link rows belonging to a happening it is not removing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    await db.insert(happeningAwareness).values({
      id: 'haw_other',
      branchId: 'b1',
      happeningId: 'hap_1',
      characterId: 'char_m',
      learnedAtEntryId: 'e1',
      decayResistance: null,
      retrievalCount: 0,
      source: 'witnessed firsthand',
    })
    await db
      .insert(deltas)
      .values([classifierDelta('d_haw_other', 6, 'happening_awareness', 'haw_other', 'e1')])

    await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    // hap_1 survives (anchored to e1), so the closure must not reach its link rows —
    // this delta is reversible and sits outside the edited entry's anchor set.
    expect((await db.select().from(happeningAwareness)).map((r) => r.id)).toEqual(['haw_other'])
    const kept = await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
    expect(kept.map((d) => d.id)).toContain('d_haw_other')
  })

  it('reverses the classifier facts anchored to the edited entry and prunes their deltas', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)

    expect((await updateStoryEntryContent('b1', 'e2', 'new', ctx)).status).toBe('ok')

    const haps = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(haps.map((h) => h.id)).toEqual(['hap_1'])
    expect(await db.select().from(happeningInvolvements)).toEqual([])
    expect(await db.select().from(happeningAwareness)).toEqual([])

    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))) as Delta[]
    expect(seededDeltaIds(remaining)).toEqual(['d_hap1', 'd_meta2'])
    expect(contentDeltas(remaining)).toHaveLength(1)
  })

  it('clamps the classifier watermark to the position before the edited entry', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)

    await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    const [row] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(row.status?.processedThrough).toBe(1)
  })

  it('mirrors the reversal into the happening stores', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    happeningsStore.hydrate('b1', [
      {
        id: 'hap_2',
        branchId: 'b1',
        title: 'derived from e2',
        description: null,
        category: null,
        icon: null,
        temporal: null,
        occurredAtEntryId: 'e2',
        commonKnowledge: 0,
        embeddingStale: 0,
        createdAt: 2,
        updatedAt: 2,
      },
    ])

    await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    expect(happeningsStore.getHappenings().has('hap_2')).toBe(false)
  })

  it('leaves the watermark alone when it already sits behind the edited entry', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    await db
      .update(branches)
      .set({ classifierStatus: classifierStatus(0) })
      .where(eq(branches.id, 'b1'))

    await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    const [row] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(row.status?.processedThrough).toBe(0)
  })

  it('commits the content edit in the same transaction as the reversal', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)

    await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    const [row] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e2')))
    expect(row.content).toBe('new')
    expect(entriesStore.getById('e2')?.content).toBe('new')
  })
})

describe('updateStoryEntryContent invalidation scope', () => {
  it('reverses and clamps nothing below the head turn', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)

    // e1 sits under the tail, so the clamp would reopen e2 while e2's facts survive.
    expect((await updateStoryEntryContent('b1', 'e1', 'reworded', ctx)).status).toBe('ok')

    const [row] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))
    expect(row.content).toBe('reworded')
    expect(entriesStore.getById('e1')?.content).toBe('reworded')
    const haps = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(haps.map((h) => h.id).sort()).toEqual(['hap_1', 'hap_2'])
    const remaining = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))) as Delta[]
    expect(seededDeltaIds(remaining)).toEqual(['d_hap1', 'd_hap2', 'd_haw2', 'd_hinv2', 'd_meta2'])
    expect(contentDeltas(remaining)).toHaveLength(1)
    const [branch] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.status?.processedThrough).toBe(2)
  })

  it('no-ops an unchanged save rather than reversing and re-deriving identical facts', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    undoRedoStore.pushRedoGroup([])

    // e2 is the tail, so without the guard this would take the full in-scope path.
    expect((await updateStoryEntryContent('b1', 'e2', 'old', ctx)).status).toBe('ok')

    const haps = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(haps.map((h) => h.id).sort()).toEqual(['hap_1', 'hap_2'])
    const remaining = await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))
    expect(remaining).toHaveLength(5)
    const [branch] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.status?.processedThrough).toBe(2)
    expect(undoRedoStore.hasRedo()).toBe(true)
  })

  it('covers the tail reply too when the head turn origin is edited', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedHeadTurn(db)

    // Clamping below e2 reopens e3, so e3's facts have to go with e2's.
    expect((await updateStoryEntryContent('b1', 'e2', 'rewritten action', ctx)).status).toBe('ok')

    const haps = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(haps.map((h) => h.id)).toEqual(['hap_1'])
    const [branch] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.status?.processedThrough).toBe(1)
  })

  it('spares the head turn origin when the tail is edited', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedHeadTurn(db)

    // The clamp lands at e3's position - 1, so the window is e3 alone and e2's facts
    // must survive — reversing them would delete what nothing re-derives.
    expect((await updateStoryEntryContent('b1', 'e3', 'rewritten reply', ctx)).status).toBe('ok')

    const haps = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(haps.map((h) => h.id).sort()).toEqual(['hap_1', 'hap_2'])
    const [branch] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.status?.processedThrough).toBe(2)
  })

  it('reads the head turn past a system tail rather than freezing under it', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedHeadTurnUnderFailure(db)

    // e2 is the last row the classifier reads, so the failure entry above it must not
    // turn this into a bare write whose stale facts nothing re-reads.
    expect((await updateStoryEntryContent('b1', 'e2', 'rewritten reply', ctx)).status).toBe('ok')

    const haps = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(haps.map((h) => h.id)).toEqual(['hap_1'])
    const [branch] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.status?.processedThrough).toBe(1)
  })

  it('still covers the origin and its reply when a system entry sits above them', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedHeadTurnUnderFailure(db)

    // Same two-entry arm as without the failure entry: clamping below e1 reopens e2.
    expect((await updateStoryEntryContent('b1', 'e1', 'rewritten action', ctx)).status).toBe('ok')

    const haps = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(haps).toHaveLength(0)
    const [branch] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.status?.processedThrough).toBe(0)
  })
})

// seedBranchWithTurns, plus a happening the swept turn t3 created and a link to it anchored to
// the surviving t1: the window spares the link, the closure takes it.
async function seedLateLink(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  ctx: DbCtx,
  logged: boolean,
) {
  await seedBranchWithTurns(db, ctx)
  await db.insert(entities).values({
    id: 'char_w',
    branchId: 'b1',
    kind: 'character',
    name: 'Wren',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await applyDeltaAction(
    {
      action: {
        kind: 'createHappening',
        source: 'ai_classifier',
        payload: {
          entry: { id: 'hap_t3', branchId: 'b1', title: 'Duel', createdAt: 1, updatedAt: 1 },
        },
      },
      actionId: 'turn3',
      branchId: 'b1',
      entryId: null,
    },
    ctx,
  )
  const late = { id: 'hinv_late', branchId: 'b1', happeningId: 'hap_t3', entityId: 'char_w' }
  if (logged)
    await applyDeltaAction(
      {
        action: {
          kind: 'createHappeningInvolvement',
          source: 'periodic_classifier',
          payload: { entry: late },
        },
        actionId: 'act_late',
        branchId: 'b1',
        entryId: 't1',
      },
      ctx,
    )
  // Only a writer outside the log makes this row (generation-pipeline.md → Reverse-replay).
  else await db.insert(happeningInvolvements).values(late)
}

async function entryIds(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  return (await db.select({ id: storyEntries.id }).from(storyEntries)).map((r) => r.id).sort()
}

describe('rollback over the closed set', () => {
  it('counts and removes a fact on a surviving turn that names a row the sweep removes', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedLateLink(db, ctx, true)
    entriesStore.hydrate('b1', [])

    // The window alone holds ent_a's create and update and hap_t3's create; the link is a fourth.
    expect(await getRollbackCounts('b1', 't2', ctx)).toEqual({
      entries: 2,
      chapters: 0,
      worldStateChanges: 4,
    })

    expect((await rollbackToEntry('b1', 't2', ctx)).status).toBe('ok')
    expect(await db.select().from(happeningInvolvements)).toEqual([])
    expect(await db.select().from(happenings)).toEqual([])
    const lps = (await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).map(
      (r) => r.logPosition,
    )
    expect(lps).toEqual([1])
  })

  it('returns the delta-failed rejection from the preview when the closure refuses', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedLateLink(db, ctx, false)
    const error = vi.spyOn(logger, 'error')

    const counts = await getRollbackCounts('b1', 't2', ctx)

    expect(counts).toEqual({
      status: 'rejected',
      code: 'delta-failed',
      reason: expect.stringContaining('no-create'),
    })
    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: 'b1', refusal: 'no-create' }),
    )
    error.mockRestore()
  })

  it("selects the preview's set only once a no-gate run's abort reversal has committed", async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedLateLink(db, ctx, true)
    const error = vi.spyOn(logger, 'error')
    await holdBranchWriteExclusive('b1', 'act_late')

    let settled = false
    const preview = getRollbackCounts('b1', 't2', ctx).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    // The run's abort reverses its link inside the hold; the preview must not count it.
    expect(await reverseReplayDeltas('act_late', ctx)).toBe(1)
    releaseBranchWriteExclusive('b1', 'act_late')

    expect(await preview).toEqual({ entries: 2, chapters: 0, worldStateChanges: 3 })
    expect(error).not.toHaveBeenCalledWith('action_layer.reversal_refused', expect.anything())
    error.mockRestore()
  })

  it('refuses a rollback the closure refuses, writing nothing and keeping redo', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedLateLink(db, ctx, false)
    entriesStore.hydrate('b1', [])
    undoRedoStore.pushRedoGroup([])
    const before = await db.select().from(deltas)

    const result = await rollbackToEntry('b1', 't2', ctx)

    expect(result).toEqual({
      status: 'rejected',
      code: 'delta-failed',
      reason: expect.stringContaining('no-create'),
    })
    expect(await db.select().from(deltas)).toEqual(before)
    expect(await entryIds(db)).toEqual(['op', 't1', 't2', 't3'])
    expect(undoRedoStore.hasRedo()).toBe(true)
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })

  it('refuses a rollback whose commit would prune a delete its group writes back', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedBranchWithTurns(db, ctx)
    entriesStore.hydrate('b1', [])
    // Unreachable through the actions: a delete of ent_a anchored to the surviving t1, grouped
    // with a write naming it, so the window spares both and the planner meets the delete.
    const [ent] = await db.select().from(entities).where(eq(entities.id, 'ent_a'))
    await db.delete(entities).where(eq(entities.id, 'ent_a'))
    await db.insert(deltas).values([
      {
        ...classifierDelta('d_del', 6, 'entities', 'ent_a', 't1'),
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        undoPayload: {
          ...ent,
          involvements: [],
          awareness: [],
          relationships: [],
          translations: [],
        },
      },
      {
        ...classifierDelta('d_ref', 7, 'entities', 'char_k', 't1'),
        actionId: 'act_del',
        source: 'user_edit',
        op: 'update',
        undoPayload: { state: { faction_id: 'ent_a' } },
      },
    ])
    undoRedoStore.pushRedoGroup([])
    const before = await db.select().from(deltas)

    const result = await rollbackToEntry('b1', 't2', ctx)

    expect(result).toEqual({
      status: 'rejected',
      code: 'delta-failed',
      reason: expect.stringContaining('write-back'),
    })
    expect(await db.select().from(deltas)).toEqual(before)
    expect(await entryIds(db)).toEqual(['op', 't1', 't2', 't3'])
    expect(undoRedoStore.hasRedo()).toBe(true)
  })
})

describe('content edit refusals', () => {
  it('refuses an edit whose sweep the closure refuses, writing nothing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    await db.insert(happeningInvolvements).values({
      id: 'hinv_raw',
      branchId: 'b1',
      happeningId: 'hap_2',
      entityId: 'char_m',
      role: null,
    })
    const before = await db.select().from(deltas)

    const result = await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    expect(result).toEqual({
      status: 'rejected',
      code: 'delta-failed',
      reason: expect.stringContaining('no-create'),
    })
    const [row] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'e2'))
    expect(row.content).toBe('old')
    expect(await db.select().from(deltas)).toEqual(before)
  })

  it('refuses an edit whose commit would prune a delete its group writes back', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedClassifiedTail(db)
    // Unreachable through the actions: the user deleted hap_2 with its links, in a group whose
    // other write names it.
    const [hap] = await db.select().from(happenings).where(eq(happenings.id, 'hap_2'))
    const involvements = await db.select().from(happeningInvolvements)
    const awareness = await db.select().from(happeningAwareness)
    await db.delete(happeningInvolvements)
    await db.delete(happeningAwareness)
    await db.delete(happenings).where(eq(happenings.id, 'hap_2'))
    await db.insert(deltas).values([
      {
        ...classifierDelta('d_del', 6, 'happenings', 'hap_2', 'e2'),
        entryId: null,
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        undoPayload: { ...hap, involvements, awareness },
      },
      {
        ...classifierDelta('d_ref', 7, 'entities', 'char_k', 'e2'),
        entryId: null,
        actionId: 'act_del',
        source: 'user_edit',
        op: 'update',
        undoPayload: { state: { current_location_id: 'hap_2' } },
      },
    ])
    undoRedoStore.pushRedoGroup([])
    const before = await db.select().from(deltas)

    const result = await updateStoryEntryContent('b1', 'e2', 'new', ctx)

    expect(result).toEqual({
      status: 'rejected',
      code: 'delta-failed',
      reason: expect.stringContaining('write-back'),
    })
    const [row] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'e2'))
    expect(row.content).toBe('old')
    expect(await db.select().from(deltas)).toEqual(before)
    expect(undoRedoStore.hasRedo()).toBe(true)
  })
})
