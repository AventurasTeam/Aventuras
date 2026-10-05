import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  pipelineRuns,
  stories,
  storyEntries,
  type Delta,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { isContentEditDelta } from './classifier-facts'
import { updateStoryEntryContent } from './operational'
import { redoLastAction, undoLastAction } from './undo'
import { applyDeltaAction } from '../delta/apply-delta-action'
import {
  DeltaReplayError,
  reverseAndPruneDeltaRows,
  reverseReplayDeltas,
} from '../delta/reverse-replay'
import { selectReversalSet } from '../delta/row-closure'
import type { PipelineAction } from '../types'

afterEach(() => {
  vi.restoreAllMocks()
  entriesStore.__reset()
  generationStore.__reset()
  undoRedoStore.clear()
})

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(storyEntries).values({
    id: 'e_opening',
    branchId: 'b1',
    position: 1,
    kind: 'opening',
    content: 'once upon a time',
    createdAt: 1,
  })
  await db.insert(storyEntries).values({
    id: 'e_turn',
    branchId: 'b1',
    position: 2,
    kind: 'ai_reply',
    content: 'a reply',
    createdAt: 2,
  })
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

const OPENING_ROW = {
  id: 'e_opening',
  branchId: 'b1',
  position: 1,
  kind: 'opening' as const,
  content: 'once upon a time',
  chapterId: null,
  metadata: null,
  createdAt: 1,
}

function hydrateOpeningAndTurn() {
  entriesStore.hydrate('b1', [
    {
      id: 'e_opening',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'once upon a time',
      chapterId: null,
      metadata: null,
      createdAt: 1,
    },
    {
      id: 'e_turn',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply',
      content: 'a reply',
      chapterId: null,
      metadata: null,
      createdAt: 2,
    },
  ])
}

describe('undoLastAction / redoLastAction', () => {
  it('removes a turn (entry + deltas) and redo restores it', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    entriesStore.hydrate('b1', [
      {
        id: 'e_opening',
        branchId: 'b1',
        position: 1,
        kind: 'opening',
        content: 'once upon a time',
        chapterId: null,
        metadata: null,
        createdAt: 1,
      },
      {
        id: 'e_turn',
        branchId: 'b1',
        position: 2,
        kind: 'ai_reply',
        content: 'a reply',
        chapterId: null,
        metadata: null,
        createdAt: 2,
      },
    ])

    const result = await undoLastAction('b1', ctx)
    expect(result.status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeUndefined()

    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeDefined()

    // Proves redo re-inserted the delta row (not just the entry): a second undo
    // must find it again and remove the entry a second time.
    const secondUndo = await undoLastAction('b1', ctx)
    expect(secondUndo.status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeUndefined()
  })

  it('clamps the classifier watermark to the undone turn - 1', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()
    await db
      .update(branches)
      .set({
        classifierStatus: {
          state: 'idle',
          lastSuccessAt: null,
          lastError: null,
          retryCount: 0,
          processedThrough: 2,
        },
      })
      .where(eq(branches.id, 'b1'))

    // e_turn is position 2 and is the entry the undo removes.
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    const [row] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(row.classifierStatus?.processedThrough).toBe(1)
  })

  it('removes a real turn (user_action + ai_reply sharing one actionId) and redo restores both', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: 'e_opening',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'once upon a time',
      createdAt: 1,
    })
    await db.insert(storyEntries).values({
      id: 'e_user',
      branchId: 'b1',
      position: 2,
      kind: 'user_action',
      content: 'I open the door',
      createdAt: 2,
    })
    await db.insert(storyEntries).values({
      id: 'e_ai',
      branchId: 'b1',
      position: 3,
      kind: 'ai_reply',
      content: 'a reply',
      createdAt: 3,
    })
    // Both deltas share one actionId (submit-turn.ts's turnActionId contract) at
    // increasing log_positions — the user_action's create is the earlier one.
    await db.insert(deltas).values({
      id: 'd_user',
      branchId: 'b1',
      actionId: 'act_turn',
      op: 'create',
      targetTable: 'story_entries',
      targetId: 'e_user',
      entryId: null,
      source: 'user_edit',
      undoPayload: null,
      logPosition: 1,
      encodingVersion: 1,
      createdAt: 2,
    })
    await db.insert(deltas).values({
      id: 'd_ai',
      branchId: 'b1',
      actionId: 'act_turn',
      op: 'create',
      targetTable: 'story_entries',
      targetId: 'e_ai',
      entryId: null,
      source: 'ai_classifier',
      undoPayload: null,
      logPosition: 2,
      encodingVersion: 1,
      createdAt: 3,
    })
    entriesStore.hydrate('b1', [
      {
        id: 'e_opening',
        branchId: 'b1',
        position: 1,
        kind: 'opening',
        content: 'once upon a time',
        chapterId: null,
        metadata: null,
        createdAt: 1,
      },
      {
        id: 'e_user',
        branchId: 'b1',
        position: 2,
        kind: 'user_action',
        content: 'I open the door',
        chapterId: null,
        metadata: null,
        createdAt: 2,
      },
      {
        id: 'e_ai',
        branchId: 'b1',
        position: 3,
        kind: 'ai_reply',
        content: 'a reply',
        chapterId: null,
        metadata: null,
        createdAt: 3,
      },
    ])

    const result = await undoLastAction('b1', ctx)
    expect(result.status).toBe('ok')
    expect(entriesStore.getById('e_user')).toBeUndefined()
    expect(entriesStore.getById('e_ai')).toBeUndefined()
    expect(entriesStore.getById('e_opening')).toBeDefined()

    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('ok')
    expect(entriesStore.getById('e_user')).toBeDefined()
    expect(entriesStore.getById('e_ai')).toBeDefined()
  })

  it('rejects when there is nothing to undo', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    // Loaded but empty: the branch-not-loaded guard would answer first otherwise.
    entriesStore.hydrate('b1', [])

    const result = await undoLastAction('b1', ctx)

    expect(result.status).toBe('rejected')
    // Hardcoded, not read off the union: this is the code the reader shows
    // "Nothing to undo." for, and the one an integrity failure must not borrow.
    if (result.status === 'rejected') expect(result.code).toBe('nothing-to-apply')
  })

  it('does not pop the redo stack when applyRedo throws (retry still works)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    expect(undoRedoStore.hasRedo()).toBe(true)

    // Re-insert the row undo deleted so applyRedo's forward INSERT hits a PK
    // conflict inside its transaction and throws — a genuine, recoverable
    // failure (no mocking of the redo primitive).
    await db.insert(storyEntries).values({
      id: 'e_turn',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply',
      content: 'a reply',
      createdAt: 2,
    })
    await expect(redoLastAction('b1', ctx)).rejects.toThrow()

    // Snapshot survives the failure: nothing was popped, redo is still pending.
    expect(undoRedoStore.hasRedo()).toBe(true)

    // Clear the conflict; the still-present snapshot now redoes successfully.
    await db.delete(storyEntries).where(eq(storyEntries.id, 'e_turn'))
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeDefined()
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('rejects redo whose snapshot belongs to a different branch, leaving the stack', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()

    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    expect(undoRedoStore.hasRedo()).toBe(true)

    // b_other must be the LOADED branch to reach the snapshot guard at all:
    // branch-not-loaded answers first, and the mismatch goes unexercised.
    entriesStore.hydrate('b_other', [])
    const wrong = await redoLastAction('b_other', ctx)
    expect(wrong.status).toBe('rejected')
    if (wrong.status === 'rejected') {
      expect(wrong.reason).toMatch(/redo stack/i)
      // A snapshot belonging to another branch is a broken redo stack, not an
      // empty one — the reader must surface it rather than say "Nothing to redo."
      expect(wrong.code).toBe('integrity')
    }

    // The mismatch must not consume branch b1's own redo.
    expect(undoRedoStore.hasRedo()).toBe(true)
    entriesStore.hydrate('b1', [OPENING_ROW])
    expect((await redoLastAction('b1', ctx)).status).toBe('ok')
    expect(entriesStore.getById('e_turn')).toBeDefined()
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('preserves the redo snapshot when reversal commits but post-commit store sync fails', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()

    // The reversal + prune tx commits, then the patcher throws → committed:true.
    vi.spyOn(entriesStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })
    await expect(undoLastAction('b1', ctx)).rejects.toBeInstanceOf(DeltaReplayError)

    // The DB change is real and committed: the delta row was pruned.
    expect((await db.select().from(deltas).where(eq(deltas.id, 'd_turn'))).length).toBe(0)
    // ...and redo capability was preserved despite the thrown store-sync error.
    expect(undoRedoStore.hasRedo()).toBe(true)
  })

  it('rejects undo/redo while generation blocks user edits', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()
    generationStore.setReversalInProgress(true)

    const undoResult = await undoLastAction('b1', ctx)
    expect(undoResult.status).toBe('rejected')
    if (undoResult.status === 'rejected') expect(undoResult.code).toBe('gated')
    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('rejected')
    if (redoResult.status === 'rejected') expect(redoResult.code).toBe('gated')
  })

  it('brackets the sweep with reversalInProgress (set then cleared)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()
    const spy = vi.spyOn(generationStore, 'setReversalInProgress')

    await undoLastAction('b1', ctx)
    expect(spy.mock.calls.map((c) => c[0])).toEqual([true, false])
    expect(generationStore.getTxState().reversalInProgress).toBe(false)

    spy.mockClear()
    await redoLastAction('b1', ctx)
    expect(spy.mock.calls.map((c) => c[0])).toEqual([true, false])
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })

  it('rejects undo/redo when the branch is not the one loaded in entriesStore', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // Loaded branch is 'b2', not 'b1' — simulates a stale branchId mid branch-switch.
    entriesStore.hydrate('b2', [])

    const undoResult = await undoLastAction('b1', ctx)
    expect(undoResult.status).toBe('rejected')

    hydrateOpeningAndTurn()
    expect((await undoLastAction('b1', ctx)).status).toBe('ok')
    entriesStore.hydrate('b2', [])
    const redoResult = await redoLastAction('b1', ctx)
    expect(redoResult.status).toBe('rejected')
  })
})

describe('undoLastAction after a reversed turn', () => {
  const DEAD_ROW = {
    id: 'e_dead',
    branchId: 'b1',
    position: 3,
    kind: 'user_action' as const,
    content: 'go north',
    chapterId: null,
    metadata: null,
    createdAt: 3,
  }

  // Shaped like submitTurn: the user_action's create delta carries the run's actionId.
  async function seedDeadTurn(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
    await seed(db)
    await db.insert(storyEntries).values(DEAD_ROW)
    await db.insert(deltas).values({
      id: 'd_dead',
      branchId: 'b1',
      actionId: 'act_dead',
      op: 'create',
      targetTable: 'story_entries',
      targetId: 'e_dead',
      entryId: null,
      source: 'user_edit',
      undoPayload: null,
      logPosition: 2,
      encodingVersion: 1,
      createdAt: 3,
    })
    entriesStore.hydrate('b1', [
      OPENING_ROW,
      { ...OPENING_ROW, id: 'e_turn', position: 2, kind: 'ai_reply', content: 'a reply' },
      DEAD_ROW,
    ])
  }

  it('undoes the last surviving turn after an aborted run', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedDeadTurn(db)
    await db.insert(pipelineRuns).values({
      runId: 'run_dead',
      kind: 'per-turn',
      actionId: 'act_dead',
      storyId: 's1',
      startedAt: 3,
    })
    await reverseReplayDeltas('act_dead', ctx, () => [
      db
        .update(pipelineRuns)
        .set({ finishedAt: 4, outcome: 'aborted' })
        .where(eq(pipelineRuns.runId, 'run_dead'))
        .toSQL(),
    ])
    expect(entriesStore.getById('e_dead')).toBeUndefined()

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(entriesStore.getById('e_turn')).toBeUndefined()
    expect(await db.select().from(storyEntries).where(eq(storyEntries.id, 'e_turn'))).toEqual([])
  })

  // A refused admission reverses its user_action with no pipeline_runs row to mark.
  it('undoes the last surviving turn after a refused admission', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedDeadTurn(db)
    await reverseReplayDeltas('act_dead', ctx)
    expect(entriesStore.getById('e_dead')).toBeUndefined()

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(entriesStore.getById('e_turn')).toBeUndefined()
    expect(await db.select().from(storyEntries).where(eq(storyEntries.id, 'e_turn'))).toEqual([])
  })
})

describe('undoLastAction over a refused closure', () => {
  it('returns integrity for a turn whose window the closure refuses, writing nothing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()
    await db
      .insert(happenings)
      .values({ id: 'hap_t', branchId: 'b1', title: 'Duel', createdAt: 2, updatedAt: 2 })
    await db.insert(deltas).values({
      id: 'd_hap',
      branchId: 'b1',
      actionId: 'act_turn',
      op: 'create',
      targetTable: 'happenings',
      targetId: 'hap_t',
      entryId: null,
      source: 'ai_classifier',
      undoPayload: null,
      logPosition: 2,
      encodingVersion: 1,
      createdAt: 2,
    })
    // Only a writer outside the log makes this row (generation-pipeline.md → Reverse-replay).
    await db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_raw', branchId: 'b1', happeningId: 'hap_t', entityId: 'char_k' })
    const before = await db.select().from(deltas)
    const error = vi.spyOn(logger, 'error')

    const result = await undoLastAction('b1', ctx)

    expect(result).toEqual({
      status: 'rejected',
      code: 'integrity',
      reason: expect.stringContaining('no-create'),
    })
    // resolveSweep logs the refusal; the undo's own bracket must not log it again.
    expect(error.mock.calls.filter(([m]) => m === 'action_layer.reversal_refused')).toHaveLength(1)
    expect(await db.select().from(deltas)).toEqual(before)
    expect(entriesStore.getById('e_turn')).toBeDefined()
    expect(undoRedoStore.hasRedo()).toBe(false)
  })
})

describe('undo and redo carry the reversal closure', () => {
  type Db = Awaited<ReturnType<typeof createTestDb>>['db']
  type Ctx = {
    db: Db
    runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
  }

  async function seedWorld(db: Db) {
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(entities).values({
      id: 'char_x',
      branchId: 'b1',
      kind: 'character',
      name: 'Mira',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await db
      .insert(happenings)
      .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
    entriesStore.hydrate('b1', [])
  }

  // Two replies, as operational.test.ts seeds them: e2 is the tail a content edit invalidates.
  async function seedTail(db: Db) {
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({
      id: 'b1',
      storyId: 's1',
      name: 'm',
      createdAt: 1,
      classifierStatus: {
        state: 'idle',
        lastSuccessAt: null,
        lastError: null,
        retryCount: 0,
        processedThrough: 2,
      },
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
  }

  const factDelta = (
    id: string,
    logPosition: number,
    targetTable: string,
    targetId: string,
    entryId: string,
  ): Delta => ({
    id,
    branchId: 'b1',
    actionId: 'act_pass',
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

  async function act(ctx: Ctx, actionId: string, action: PipelineAction) {
    const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
    if (result.status !== 'ok')
      throw new Error(`${action.kind} did not land: ${JSON.stringify(result)}`)
  }

  async function contentOf(db: Db, id: string) {
    const [row] = await db
      .select({ content: storyEntries.content })
      .from(storyEntries)
      .where(eq(storyEntries.id, id))
    return row.content
  }

  async function esk(db: Db) {
    return {
      character: await db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.id, 'char_e')),
      involvements: await db.select({ id: happeningInvolvements.id }).from(happeningInvolvements),
      awareness: await db.select({ id: happeningAwareness.id }).from(happeningAwareness),
      relationships: await db
        .select({ id: characterRelationships.id })
        .from(characterRelationships),
    }
  }

  const none = { character: [], involvements: [], awareness: [], relationships: [] }

  it("CTRL-Z of a user-created character takes the pass's links, and redo brings all four back", async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedWorld(db)
    await act(ctx, 'act_user', {
      kind: 'createEntity',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'char_e',
          branchId: 'b1',
          kind: 'character',
          name: 'Esk',
          status: 'active',
          injectionMode: 'auto',
          createdAt: 2,
          updatedAt: 2,
        },
      },
    })
    await act(ctx, 'act_pass', {
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_e', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_e' },
      },
    })
    await act(ctx, 'act_pass', {
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', happeningId: 'hap_1', characterId: 'char_e' },
    })
    await act(ctx, 'act_pass', {
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: 'b1',
        subjectId: 'char_e',
        objectId: 'char_x',
        kind: 'ally',
        proseEntryId: null,
      },
    })
    const created = await esk(db)
    expect(Object.values(created).map((rows) => rows.length)).toEqual([1, 1, 1, 1])

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await esk(db)).toEqual(none)
    expect(await db.select().from(deltas)).toEqual([])

    expect(await redoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await esk(db)).toEqual(created)
    const logged = (await db.select().from(deltas)) as Delta[]
    expect(logged.map((d) => d.targetTable).sort()).toEqual([
      'character_relationships',
      'entities',
      'happening_awareness',
      'happening_involvements',
    ])

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await esk(db)).toEqual(none)
    expect(await db.select().from(deltas)).toEqual([])
  })

  it("leaves a content edit's swept facts, and what the closure reaches from them, out of redo", async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedTail(db)
    expect((await updateStoryEntryContent('b1', 'e2', 'new prose', ctx)).status).toBe('ok')
    // A pass re-derives from the new prose: a happening anchored to e2, and awareness of it
    // anchored to e1, which only the closure reaches.
    await db.insert(happenings).values({
      id: 'hap_new',
      branchId: 'b1',
      title: 'from the new prose',
      occurredAtEntryId: 'e2',
      createdAt: 3,
      updatedAt: 3,
    })
    await db.insert(happeningAwareness).values({
      id: 'haw_early',
      branchId: 'b1',
      happeningId: 'hap_new',
      characterId: 'char_k',
      learnedAtEntryId: 'e1',
      decayResistance: null,
      retrievalCount: 0,
      source: 'told',
    })
    await db
      .insert(deltas)
      .values([
        factDelta('d_hap_new', 2, 'happenings', 'hap_new', 'e2'),
        factDelta('d_haw_early', 3, 'happening_awareness', 'haw_early', 'e1'),
      ])

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await contentOf(db, 'e2')).toBe('old')
    expect(await db.select().from(happenings)).toEqual([])
    expect(await db.select().from(happeningAwareness)).toEqual([])
    expect(await db.select().from(deltas)).toEqual([])

    expect(await redoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await contentOf(db, 'e2')).toBe('new prose')
    expect(await db.select().from(happenings)).toEqual([])
    expect(await db.select().from(happeningAwareness)).toEqual([])
    const logged = (await db.select().from(deltas)) as Delta[]
    expect(logged).toHaveLength(1)
    expect(isContentEditDelta(logged[0])).toBe(true)
  })

  it('refuses a CTRL-Z whose redo would restore a row a delete holds, writing nothing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedWorld(db)
    await act(ctx, 'act_user', {
      kind: 'createHappening',
      source: 'user_edit',
      payload: {
        entry: { id: 'hap_u', branchId: 'b1', title: 'Duel', createdAt: 2, updatedAt: 2 },
      },
    })
    // Unreachable through the actions: a classifier delete of the user's happening, which
    // CTRL-Z steps over to reach the create.
    const [row] = await db.select().from(happenings).where(eq(happenings.id, 'hap_u'))
    await db.delete(happenings).where(eq(happenings.id, 'hap_u'))
    await db.insert(deltas).values({
      id: 'd_cdel',
      branchId: 'b1',
      actionId: 'act_c',
      op: 'delete',
      targetTable: 'happenings',
      targetId: 'hap_u',
      entryId: null,
      source: 'periodic_classifier',
      undoPayload: { ...row, involvements: [], awareness: [] },
      logPosition: 2,
      encodingVersion: 1,
      createdAt: 2,
    })
    const before = await db.select().from(deltas)
    const error = vi.spyOn(logger, 'error')

    const result = await undoLastAction('b1', ctx)

    expect(result).toEqual({
      status: 'rejected',
      code: 'integrity',
      reason: expect.stringContaining('held-in-redo'),
    })
    expect(await db.select().from(deltas)).toEqual(before)
    expect(undoRedoStore.hasRedo()).toBe(false)
    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: 'b1', refusal: 'held-in-redo' }),
    )
  })
})

// Unreachable through the actions: a machine write nulls a relationship view, so an undo would
// prune the pair's writes outside its redo (generation-pipeline.md → Reverse-replay).
describe('a CTRL-Z whose reversal would prune writes outside its redo', () => {
  type Db = Awaited<ReturnType<typeof createTestDb>>['db']

  const onPair = (
    id: string,
    logPosition: number,
    over: Partial<Delta> & Pick<Delta, 'actionId'>,
  ): Delta => ({
    id,
    branchId: 'b1',
    op: 'update',
    targetTable: 'character_relationships',
    targetId: 'rel_1',
    entryId: null,
    source: 'user_edit',
    undoPayload: null,
    logPosition,
    encodingVersion: 1,
    createdAt: logPosition,
    ...over,
  })

  // char_x < char_y: `kind` is char_x's view, `inverseKind` char_y's.
  async function seedPair(db: Db) {
    await db.insert(characterRelationships).values({
      id: 'rel_1',
      branchId: 'b1',
      aId: 'char_x',
      bId: 'char_y',
      kind: 'rival',
      inverseKind: null,
      createdAt: 1,
      updatedAt: 1,
    })
  }

  // The user's pair (mentor), the user's `kind`, then a pass nulling `inverseKind`.
  async function seedStrandingGroup(db: Db) {
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await seedPair(db)
    await db.insert(deltas).values([
      onPair('d_pair', 1, { actionId: 'act_u0', op: 'create' }),
      onPair('d_kind', 2, { actionId: 'act_u1', undoPayload: { kind: null } }),
      onPair('d_null', 3, {
        actionId: 'act_pass',
        source: 'periodic_classifier',
        undoPayload: { inverseKind: 'mentor' },
      }),
    ])
    entriesStore.hydrate('b1', [])
  }

  async function expectNothingWritten(db: Db, before: unknown) {
    expect(await db.select().from(deltas)).toEqual(before)
    expect(await db.select().from(characterRelationships)).toEqual([
      expect.objectContaining({ id: 'rel_1', kind: 'rival', inverseKind: null }),
    ])
  }

  function refusalsLogged(error: { mock: { calls: unknown[][] } }) {
    return error.mock.calls.filter(([m]) => m === 'action_layer.reversal_refused')
  }

  it("refuses a group's CTRL-Z, writing nothing and leaving no redo", async () => {
    const { db, runInTransaction } = await createTestDb()
    await seedStrandingGroup(db)
    const before = await db.select().from(deltas)
    const error = vi.spyOn(logger, 'error')

    const result = await undoLastAction('b1', { db, runInTransaction })

    expect(result).toEqual({
      status: 'rejected',
      code: 'integrity',
      reason: expect.stringContaining('pruned-outside-redo'),
    })
    expect(refusalsLogged(error)).toEqual([
      [
        'action_layer.reversal_refused',
        expect.objectContaining({ branchId: 'b1', refusal: 'pruned-outside-redo' }),
      ],
    ])
    await expectNothingWritten(db, before)
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it("prunes the pair's writes when the same set reverses outside CTRL-Z", async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seedStrandingGroup(db)
    const target = (await db.select().from(deltas).where(eq(deltas.actionId, 'act_u1'))) as Delta[]

    await reverseAndPruneDeltaRows(await selectReversalSet(ctx, { branchId: 'b1', target }), ctx, {
      keepRedoExact: false,
    })

    expect(await db.select().from(characterRelationships)).toEqual([])
    expect(await db.select().from(deltas)).toEqual([])
  })

  it("refuses a turn's CTRL-Z whose window spares the pair's other writes", async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    hydrateOpeningAndTurn()
    await seedPair(db)
    // The turn's create moves to 3: the pair's create below it and the pass anchored to the
    // opening fall outside its window.
    await db.update(deltas).set({ logPosition: 3 }).where(eq(deltas.id, 'd_turn'))
    await db.insert(deltas).values([
      onPair('d_pair', 1, { actionId: 'act_u0', op: 'create' }),
      onPair('d_null', 2, {
        actionId: 'act_pass',
        source: 'periodic_classifier',
        entryId: 'e_opening',
        undoPayload: { inverseKind: 'mentor' },
      }),
      onPair('d_kind', 4, {
        actionId: 'act_turn',
        source: 'ai_classifier',
        undoPayload: { kind: null },
      }),
    ])
    const before = await db.select().from(deltas)

    const result = await undoLastAction('b1', { db, runInTransaction })

    expect(result).toEqual({
      status: 'rejected',
      code: 'integrity',
      reason: expect.stringContaining('pruned-outside-redo'),
    })
    await expectNothingWritten(db, before)
    expect(entriesStore.getById('e_turn')).toBeDefined()
    expect(undoRedoStore.hasRedo()).toBe(false)
  })
})

// A pass on an earlier turn can log above a turn's writes and stay when CTRL-Z skips it, so
// a redo that moved the turn's writes to the head would reorder them against a user write.
describe('redo restores the order the writes first logged in', () => {
  it("keeps a user's view on a pair the turn's pass created, through undo, redo and a prose edit", async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    hydrateOpeningAndTurn()
    // char_x < char_y: `kind` is the pass's view, `inverseKind` the user's.
    await db.insert(characterRelationships).values({
      id: 'rel_1',
      branchId: 'b1',
      aId: 'char_x',
      bId: 'char_y',
      kind: 'rival',
      inverseKind: 'mentor',
      createdAt: 2,
      updatedAt: 3,
    })
    await db
      .insert(happenings)
      .values({ id: 'hap_lag', branchId: 'b1', title: 'Lagging', createdAt: 4, updatedAt: 4 })
    const row = {
      branchId: 'b1',
      targetTable: 'character_relationships',
      targetId: 'rel_1',
      undoPayload: null,
      encodingVersion: 1,
    } as const
    await db.insert(deltas).values([
      {
        ...row,
        id: 'd_rel',
        actionId: 'act_pass',
        op: 'create',
        entryId: 'e_turn',
        source: 'periodic_classifier',
        logPosition: 2,
        createdAt: 2,
      },
      {
        ...row,
        id: 'd_view',
        actionId: 'act_view',
        op: 'update',
        entryId: null,
        source: 'user_edit',
        undoPayload: { inverseKind: null },
        logPosition: 3,
        createdAt: 3,
      },
      {
        ...row,
        id: 'd_lag',
        actionId: 'act_lag',
        op: 'create',
        targetTable: 'happenings',
        targetId: 'hap_lag',
        entryId: 'e_opening',
        source: 'periodic_classifier',
        logPosition: 4,
        createdAt: 4,
      },
    ])
    const positions = async () =>
      Object.fromEntries(
        (await db.select().from(deltas)).map((d) => [d.id, d.logPosition] as const),
      )
    const before = await positions()

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await db.select().from(characterRelationships)).toEqual([])
    expect(await redoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await redoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await positions()).toEqual(before)

    expect((await updateStoryEntryContent('b1', 'e_turn', 'a rewritten reply', ctx)).status).toBe(
      'ok',
    )

    expect(await db.select().from(characterRelationships)).toEqual([
      expect.objectContaining({ id: 'rel_1', kind: null, inverseKind: 'mentor' }),
    ])
    expect(await db.select().from(deltas).where(eq(deltas.id, 'd_view'))).toHaveLength(1)
  })
})
