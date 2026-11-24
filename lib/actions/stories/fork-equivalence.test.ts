import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assets,
  branches,
  emptyEntityState,
  stories,
  storyEntries,
  vecTableName,
  type CharacterState,
  type DbCtx,
  type NewEntity,
  type NewStoryEntry,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { branchSnapshot } from '@/lib/db/__tests__/two-branch'
import {
  entitiesStore,
  entriesStore,
  generationStore,
  resetAllStores,
  undoRedoStore,
} from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetBranchWriteLocks } from '../delta/branch-write-lock'
import { writeSystemEntry } from '../story-entries/system-entry'
import { undoLastAction } from '../story-entries/undo'
import type { PipelineAction } from '../types'
import {
  appendTurns,
  assertFork,
  closeByHand,
  createEntityAction,
  createHappeningAction,
  deltaRowsOf,
  entryAt,
  entryIdsOn,
  FORK_CHILD_ID,
  forkPlan,
  idsOn,
  journalIdsOn,
  landWrites,
  openForkWorld,
  rerunByHand,
  rowOn,
  rowsOn,
  seedForkVectors,
  seedVectorsWithWindowLore,
  vectorRows,
  type ForkWorld,
} from './__tests__/fork-harness'

afterEach(() => {
  resetAllStores()
})

describe('a fork reaches every restore path', () => {
  const ROOK = 'char_fork_rook'
  const MIRA = 'char_fork_mira'
  const KAEL = 'char_fork_kael'
  const FORD = 'hap_fork_ford'

  it('puts back a character deleted inside the window with its captured links, the bump on one undone', async () => {
    const w = await openForkWorld(1)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, ROOK, 'Rook'),
      createEntityAction(w, MIRA, 'Mira'),
      createHappeningAction(w, FORD, 'The ford gives way'),
      {
        kind: 'upsertHappeningAwareness',
        source: 'periodic_classifier',
        payload: { branchId: w.parentId, happeningId: FORD, characterId: ROOK, proseEntryId: null },
      },
      {
        kind: 'upsertCharacterRelationship',
        source: 'periodic_classifier',
        payload: {
          branchId: w.parentId,
          subjectId: ROOK,
          objectId: MIRA,
          kind: 'owes a debt',
          proseEntryId: null,
        },
      },
    ])
    const awareness = rowsOn(w, 'happening_awareness', w.parentId)
    const pairs = rowsOn(w, 'character_relationships', w.parentId)
    expect(awareness).toHaveLength(1)
    expect(pairs).toHaveLength(1)
    const awarenessId = String(awareness[0].id)
    const pairId = String(pairs[0].id)
    await appendTurns(w, 2)
    await landWrites(w, { actionId: 'act_fork_retrieval', entryId: entryAt(5) }, [
      {
        kind: 'bumpAwarenessRetrieval',
        source: 'ai_classifier',
        payload: { branchId: w.parentId, id: awarenessId, priorCount: 0 },
      },
    ])
    expect(rowOn(w, 'happening_awareness', w.parentId, awarenessId)).toMatchObject({
      retrieval_count: 1,
    })
    await landWrites(w, { actionId: 'act_fork_delete_rook', entryId: null }, [
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId: w.parentId, id: ROOK } },
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const deleted = [
      ['entities', ROOK],
      ['character_relationships', pairId],
      ['happening_awareness', awarenessId],
    ] as const
    for (const [table, id] of deleted)
      expect(rowOn(w, table, w.parentId, id), table).toBeUndefined()

    const { childId } = await assertFork(w, entryAt(3))

    expect(rowOn(w, 'entities', childId, ROOK)).toMatchObject({ name: 'Rook' })
    // MIRA < ROOK, so the pair's `a` is Mira and Rook's view sits in `inverse_kind`.
    expect(rowOn(w, 'character_relationships', childId, pairId)).toMatchObject({
      a_id: MIRA,
      b_id: ROOK,
      kind: null,
      inverse_kind: 'owes a debt',
    })
    expect(rowOn(w, 'happening_awareness', childId, awarenessId)).toMatchObject({
      character_id: ROOK,
      retrieval_count: 0,
    })
    for (const [table, id] of deleted)
      expect(rowOn(w, table, w.parentId, id), table).toBeUndefined()
  })

  it('re-inserts a pair the walk tombstoned once an older undo gives it a view back', async () => {
    const w = await openForkWorld(1)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, KAEL, 'Kael'),
      createEntityAction(w, MIRA, 'Mira'),
    ])
    await landWrites(w, { actionId: 'act_fork_pair', entryId: null }, [
      {
        kind: 'upsertCharacterRelationship',
        source: 'user_edit',
        payload: {
          branchId: w.parentId,
          subjectId: KAEL,
          objectId: MIRA,
          kind: 'k',
          inverseKind: 'w',
        },
      },
    ])
    const pairs = rowsOn(w, 'character_relationships', w.parentId)
    expect(pairs).toHaveLength(1)
    const pairId = String(pairs[0].id)
    await appendTurns(w, 2)
    // KAEL < MIRA, so `kind` is Kael's view and `inverse_kind` Mira's.
    const view = (subjectId: string, objectId: string, kind: string | null): PipelineAction => ({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: { branchId: w.parentId, subjectId, objectId, kind, proseEntryId: null },
    })
    await landWrites(w, { actionId: 'act_fork_clear_kind', entryId: entryAt(5) }, [
      view(KAEL, MIRA, null),
    ])
    await landWrites(w, { actionId: 'act_fork_set_kind', entryId: entryAt(7) }, [
      view(KAEL, MIRA, 'b'),
    ])
    // Anchored on the fork entry, before B, so the window spares it; an unanchored write would go.
    await landWrites(w, { actionId: 'act_fork_clear_inverse', entryId: entryAt(3) }, [
      view(MIRA, KAEL, null),
    ])
    const parentPair = rowOn(w, 'character_relationships', w.parentId, pairId)
    expect(parentPair).toMatchObject({ kind: 'b', inverse_kind: null })
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: KAEL })

    const { childId } = await assertFork(w, entryAt(3))

    expect(rowOn(w, 'character_relationships', childId, pairId)).toMatchObject({
      a_id: KAEL,
      b_id: MIRA,
      kind: 'k',
      inverse_kind: null,
    })
    expect(rowOn(w, 'character_relationships', w.parentId, pairId)).toEqual(parentPair)
  })
})

describe('a fork rewrites the log it keeps on the child alone', () => {
  const KAEL = 'char_fork_kael'
  const MIRA = 'char_fork_mira'
  const STATE: CharacterState = {
    visual: { attire: 'travel cloak' },
    traits: ['brave'],
    drives: [],
    voice: 'low and dry',
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: null,
    lastSeenAt: null,
  }

  // Kael and Mira before B, then entries 4-7 after them.
  async function kaelAndMira(kael: Partial<NewEntity> = {}): Promise<ForkWorld> {
    const w = await openForkWorld(1)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, KAEL, 'Kael', kael),
      createEntityAction(w, MIRA, 'Mira'),
    ])
    await appendTurns(w, 2)
    return w
  }

  const passPair = (w: ForkWorld, kind: string): PipelineAction => ({
    kind: 'upsertCharacterRelationship',
    source: 'periodic_classifier',
    payload: { branchId: w.parentId, subjectId: KAEL, objectId: MIRA, kind, proseEntryId: null },
  })

  it("rewrites a held delete's payload on the child, the parent's holder as logged", async () => {
    const w = await kaelAndMira()
    await landWrites(w, { actionId: 'act_fork_pass_pair', entryId: entryAt(5) }, [
      passPair(w, 'wary'),
    ])
    const pairs = rowsOn(w, 'character_relationships', w.parentId)
    expect(pairs).toHaveLength(1)
    const pairId = String(pairs[0].id)
    await landWrites(w, { actionId: 'act_fork_delete_kael', entryId: entryAt(3) }, [
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId: w.parentId, id: KAEL } },
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const holders = deltaRowsOf(w, w.parentId, 'act_fork_delete_kael')
    expect(holders).toHaveLength(1)
    const holderId = String(holders[0].id)
    const planned = await forkPlan(w, entryAt(3), FORK_CHILD_ID)
    expect(planned?.plan.rewrittenHolders.map((d) => d.id)).toEqual([holderId])

    const { childId } = await assertFork(w, entryAt(3))

    const payloadOn = (branchId: string) =>
      String(rowOn(w, 'deltas', branchId, holderId)?.undo_payload)
    expect(payloadOn(childId)).toContain(KAEL)
    expect(payloadOn(childId)).not.toContain(pairId)
    expect(payloadOn(w.parentId)).toContain(pairId)
  })

  it("rewrites a surviving later write's prior value on the child alone", async () => {
    const w = await kaelAndMira({ state: STATE })
    const withVoice = (voice: string) => ({ state: { ...STATE, voice } })
    await landWrites(w, { actionId: 'act_fork_close_voice', entryId: entryAt(5) }, [
      {
        kind: 'updateEntity',
        source: 'chapter_close',
        payload: { branchId: w.parentId, id: KAEL, patch: withVoice('hoarse') },
      },
    ])
    await landWrites(w, { actionId: 'act_fork_pass_voice', entryId: entryAt(3) }, [
      {
        kind: 'updateEntity',
        source: 'periodic_classifier',
        payload: { branchId: w.parentId, id: KAEL, patch: withVoice('steady') },
      },
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const survivors = deltaRowsOf(w, w.parentId, 'act_fork_pass_voice')
    expect(survivors).toHaveLength(1)
    const survivorId = String(survivors[0].id)
    const planned = await forkPlan(w, entryAt(3), FORK_CHILD_ID)
    expect(planned?.plan.survivorRewrites.map(({ delta }) => delta.id)).toEqual([survivorId])

    const { childId } = await assertFork(w, entryAt(3))

    const priorVoice = (branchId: string) =>
      (
        JSON.parse(String(rowOn(w, 'deltas', branchId, survivorId)?.undo_payload)) as {
          state?: { voice?: string }
        }
      ).state?.voice
    expect(priorVoice(childId)).toBe('low and dry')
    expect(priorVoice(w.parentId)).toBe('hoarse')
    const kaelOn = (branchId: string) =>
      JSON.parse(String(rowOn(w, 'entities', branchId, KAEL)?.state)) as CharacterState
    expect(kaelOn(childId).voice).toBe('steady')
  })

  it('re-owns on the child a machine create a later user write kept', async () => {
    const w = await kaelAndMira()
    await landWrites(w, { actionId: 'act_fork_pass_pair', entryId: entryAt(5) }, [
      passPair(w, 'rival'),
    ])
    const creates = deltaRowsOf(w, w.parentId, 'act_fork_pass_pair')
    expect(creates).toHaveLength(1)
    const created = creates[0]
    await landWrites(w, { actionId: 'act_fork_keep', entryId: entryAt(3) }, [
      {
        kind: 'upsertCharacterRelationship',
        source: 'user_edit',
        payload: {
          branchId: w.parentId,
          subjectId: KAEL,
          objectId: MIRA,
          kind: 'rival',
          inverseKind: 'mentor',
        },
      },
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const planned = await forkPlan(w, entryAt(3), FORK_CHILD_ID)
    expect(planned?.plan.reownedDeltas.map((d) => d.id)).toEqual([created.id])

    const { childId } = await assertFork(w, entryAt(3))

    expect(rowOn(w, 'deltas', childId, String(created.id))).toMatchObject({
      source: 'user_edit',
      entry_id: null,
      action_id: 'act_fork_keep',
    })
    expect(rowOn(w, 'deltas', w.parentId, String(created.id))).toEqual(created)
    // The user wrote Mira's view only, so the swept pass's view goes and the row stays.
    expect(rowOn(w, 'character_relationships', childId, String(created.target_id))).toMatchObject({
      kind: null,
      inverse_kind: 'mentor',
    })
  })

  it('prunes on the child a user edit before B of a row the window creates', async () => {
    const WREN = 'char_fork_wren'
    const w = await kaelAndMira()
    await landWrites(w, { actionId: 'act_fork_pass_wren', entryId: entryAt(5) }, [
      createEntityAction(w, WREN, 'Wren'),
    ])
    await landWrites(w, { actionId: 'act_fork_rename_wren', entryId: entryAt(3) }, [
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: w.parentId, id: WREN, patch: { name: 'Wrenna' } },
      },
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const edits = deltaRowsOf(w, w.parentId, 'act_fork_rename_wren')
    expect(edits).toHaveLength(1)
    const editId = String(edits[0].id)
    const planned = await forkPlan(w, entryAt(3), FORK_CHILD_ID)
    const windowIds = new Set(planned?.swept.window.map((d) => d.id))
    expect(planned?.plan.prunedDeltas.filter((d) => !windowIds.has(d.id)).map((d) => d.id)).toEqual(
      [editId],
    )

    const { childId } = await assertFork(w, entryAt(3))

    expect(rowOn(w, 'deltas', childId, editId)).toBeUndefined()
    expect(rowOn(w, 'entities', childId, WREN)).toBeUndefined()
    expect(rowOn(w, 'deltas', w.parentId, editId)).toEqual(edits[0])
    expect(rowOn(w, 'entities', w.parentId, WREN)).toMatchObject({ name: 'Wrenna' })
  })

  it('prunes, as rollback does where CTRL-Z refuses, the writes stranded on a pair the window empties', async () => {
    const w = await kaelAndMira()
    // KAEL < MIRA, so `kind` is Kael's view and `inverse_kind` Mira's.
    await landWrites(w, { actionId: 'act_fork_user_pair', entryId: entryAt(1) }, [
      {
        kind: 'upsertCharacterRelationship',
        source: 'user_edit',
        payload: {
          branchId: w.parentId,
          subjectId: KAEL,
          objectId: MIRA,
          kind: null,
          inverseKind: 'mentor',
        },
      },
    ])
    await landWrites(w, { actionId: 'act_fork_pass_pair', entryId: entryAt(5) }, [
      passPair(w, 'rival'),
    ])
    await landWrites(w, { actionId: 'act_fork_pass_clear', entryId: entryAt(3) }, [
      {
        kind: 'upsertCharacterRelationship',
        source: 'periodic_classifier',
        payload: {
          branchId: w.parentId,
          subjectId: MIRA,
          objectId: KAEL,
          kind: null,
          proseEntryId: null,
        },
      },
    ])
    const pairs = rowsOn(w, 'character_relationships', w.parentId)
    expect(pairs).toMatchObject([{ kind: 'rival', inverse_kind: null }])
    const pairId = String(pairs[0].id)
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const strandedIds = [
      ...deltaRowsOf(w, w.parentId, 'act_fork_user_pair'),
      ...deltaRowsOf(w, w.parentId, 'act_fork_pass_clear'),
    ]
      .map((d) => String(d.id))
      .sort()
    expect(strandedIds).toHaveLength(2)
    // Pruned though outside the set, so stranded, not swept: the writes CTRL-Z's plan refuses on.
    const planned = await forkPlan(w, entryAt(3), FORK_CHILD_ID)
    const setIds = new Set(planned?.swept.set.rows.map((d) => d.id))
    expect(
      planned?.plan.prunedDeltas
        .filter((d) => !setIds.has(d.id))
        .map((d) => d.id)
        .sort(),
    ).toEqual(strandedIds)

    const { childId } = await assertFork(w, entryAt(3))

    expect(rowOn(w, 'character_relationships', childId, pairId)).toBeUndefined()
    for (const id of strandedIds) expect(rowOn(w, 'deltas', childId, id), id).toBeUndefined()
    expect(rowOn(w, 'character_relationships', w.parentId, pairId)).toEqual(pairs[0])
  })

  it("clears on the child a place's parent and a member's faction the window removes", async () => {
    const PIER = 'loc_fork_pier'
    const QUAY = 'loc_fork_quay'
    const TAMSIN = 'char_fork_tamsin'
    const WARDENS = 'fact_fork_wardens'
    const w = await openForkWorld(1)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, PIER, "Tobin's Pier", {
        kind: 'location',
        state: { parent_location_id: null },
      }),
      createEntityAction(w, TAMSIN, 'Tamsin', {
        state: { ...emptyEntityState('character'), faction_id: null },
      }),
      createEntityAction(w, MIRA, 'Mira'),
    ])
    await appendTurns(w, 2)
    await landWrites(w, { actionId: 'act_fork_pass_world', entryId: entryAt(5) }, [
      createEntityAction(w, QUAY, 'Harrow Quay', {
        kind: 'location',
        state: { parent_location_id: null },
      }),
      createEntityAction(w, WARDENS, 'The Wardens', { kind: 'faction' }),
    ])
    await landWrites(w, { actionId: 'act_fork_move', entryId: entryAt(3) }, [
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: w.parentId, id: PIER, patch: { state: { parent_location_id: QUAY } } },
      },
    ])
    await landWrites(w, { actionId: 'act_fork_join', entryId: entryAt(3) }, [
      {
        kind: 'setCharacterFaction',
        source: 'periodic_classifier',
        payload: { branchId: w.parentId, id: TAMSIN, factionId: WARDENS, proseEntryId: null },
      },
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const planned = await forkPlan(w, entryAt(3), FORK_CHILD_ID)
    expect(
      planned?.swept.set.refClears.map(({ row, ref }) => `${row.id}.${ref.path}`).sort(),
    ).toEqual([`${PIER}.parent_location_id`, `${TAMSIN}.faction_id`].sort())

    const { childId } = await assertFork(w, entryAt(3))

    const stateOn = (branchId: string, id: string) =>
      JSON.parse(String(rowOn(w, 'entities', branchId, id)?.state)) as Record<string, unknown>
    expect(stateOn(childId, PIER)).toMatchObject({ parent_location_id: null, unplaced: true })
    expect(stateOn(childId, TAMSIN)).toMatchObject({ faction_id: null })
    expect(stateOn(w.parentId, PIER)).toMatchObject({ parent_location_id: QUAY })
    expect(stateOn(w.parentId, TAMSIN)).toMatchObject({ faction_id: WARDENS })
  })
})

describe('a fork across a close, its assets and its re-run', () => {
  const TOBIN = 'char_fork_tobin'
  const CHAPTER = 'chap_fork_crossing'
  const RERUN = 'act_fork_rerun'

  // Tobin before B; entries 1-7; a close of entries 1-5, run while entries 6 and 7 stood.
  async function closedParent(): Promise<ForkWorld> {
    const w = await openForkWorld(1)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, TOBIN, 'Tobin'),
    ])
    await appendTurns(w, 2)
    await closeByHand(w, {
      chapterId: CHAPTER,
      actionId: 'act_fork_close',
      startPosition: 1,
      endPosition: 5,
      loreId: 'lore_fork_close',
    })
    return w
  }

  async function rerunParent(): Promise<ForkWorld> {
    const w = await closedParent()
    await rerunByHand(w, {
      chapterId: CHAPTER,
      endEntryId: entryAt(5),
      actionId: RERUN,
      runId: 'run_fork_rerun',
      loreId: 'lore_fork_rerun',
    })
    expect(journalIdsOn(w, w.parentId)).toEqual([RERUN])
    return w
  }

  const chapterIdsOn = (w: ForkWorld, branchId: string) =>
    entryIdsOn(w, branchId).map((id) => rowOn(w, 'story_entries', branchId, id)?.chapter_id)

  it('drops a chapter that ends after the fork entry and reopens the entries it keeps', async () => {
    const w = await closedParent()
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: TOBIN })
    expect(chapterIdsOn(w, w.parentId)).toEqual([
      CHAPTER,
      CHAPTER,
      CHAPTER,
      CHAPTER,
      CHAPTER,
      null,
      null,
    ])

    const { childId } = await assertFork(w, entryAt(3))

    expect(rowOn(w, 'chapters', childId, CHAPTER)).toBeUndefined()
    expect(chapterIdsOn(w, childId)).toEqual([null, null, null])
    expect(rowOn(w, 'chapters', w.parentId, CHAPTER)).toBeDefined()
  })

  it('drops the entry_assets row the window created and keeps the one created before B', async () => {
    const w = await openForkWorld(1)
    await w.ctx.db.insert(assets).values({
      id: 'asset_fork_map',
      kind: 'image',
      filePath: 'assets/asset_fork_map.png',
      createdAt: 1,
    })
    const assetOn = (entryId: string, id: string): PipelineAction => ({
      kind: 'createEntryAsset',
      source: 'user_edit',
      payload: {
        entry: {
          id,
          branchId: w.parentId,
          entryId,
          assetId: 'asset_fork_map',
          role: 'illustration',
          position: 0,
        },
      },
    })
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, TOBIN, 'Tobin'),
      assetOn(entryAt(3), 'ea_fork_kept'),
    ])
    await appendTurns(w, 2)
    // Unanchored and logged after B, so the window takes it whichever entry its row is on.
    await landWrites(w, { actionId: 'act_fork_asset', entryId: null }, [
      assetOn(entryAt(5), 'ea_fork_gone'),
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: TOBIN })

    const { childId } = await assertFork(w, entryAt(3))

    expect(idsOn(w, 'entry_assets', childId)).toEqual(['ea_fork_kept'])
    expect(idsOn(w, 'entry_assets', w.parentId)).toEqual(['ea_fork_gone', 'ea_fork_kept'])
  })

  describe("the re-run's journal across a fork", () => {
    it('1. copies it when the fork entry is the narrative tail', async () => {
      const w = await rerunParent()
      await seedVectorsWithWindowLore(w, entryAt(7), { kind: 'entity', id: TOBIN })

      const { childId, facts } = await assertFork(w, entryAt(7))

      expect(facts).toMatchObject({ hasB: false, droppedJournalIds: [] })
      expect(journalIdsOn(w, childId)).toEqual([RERUN])
    })

    it('2. drops it when the chapter ends after the fork entry', async () => {
      const w = await rerunParent()
      await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: TOBIN })

      const { childId, facts } = await assertFork(w, entryAt(3))

      expect(facts).toMatchObject({ hasB: true, droppedJournalIds: [RERUN] })
      expect(journalIdsOn(w, childId)).toEqual([])
      expect(rowOn(w, 'chapters', childId, CHAPTER)).toBeUndefined()
    })

    it('3. copies it when the chapter ends at or before the fork entry and the re-run came before B', async () => {
      const w = await rerunParent()
      await appendTurns(w, 1)
      await seedVectorsWithWindowLore(w, entryAt(9), { kind: 'entity', id: TOBIN })

      const { childId, facts } = await assertFork(w, entryAt(7))

      expect(facts).toMatchObject({ hasB: true, droppedJournalIds: [] })
      expect(journalIdsOn(w, childId)).toEqual([RERUN])
      expect(rowOn(w, 'chapters', childId, CHAPTER)).toBeDefined()
    })

    it('4. drops it when the chapter ends at or before the fork entry and the re-run came after B', async () => {
      const w = await rerunParent()
      await seedVectorsWithWindowLore(w, entryAt(7), { kind: 'entity', id: TOBIN })

      const { childId, facts } = await assertFork(w, entryAt(5))

      expect(facts).toMatchObject({ hasB: true, droppedJournalIds: [RERUN] })
      expect(journalIdsOn(w, childId)).toEqual([])
      expect(rowOn(w, 'chapters', childId, CHAPTER)).toBeDefined()
    })
  })
})

describe('a fork at the edges of the log', () => {
  const MIRA = 'char_fork_mira'
  // lib/db/bind-limit.ts's SQLITE_MAX_BIND_VARS, module-local there.
  const SQLITE_BIND_CAP = 32_766
  const BULK_TURNS = 32_800
  const BULK_AT = 1_767_500_000_000

  // Entries past the tail and their create deltas, in raw SQL: the action layer would take minutes.
  function appendBulkTurns(w: ForkWorld, count: number): void {
    const { top } = w.sqlite
      .prepare('SELECT max(log_position) AS top FROM deltas WHERE branch_id = ?')
      .get(w.parentId) as { top: number }
    const { tail } = w.sqlite
      .prepare('SELECT max(position) AS tail FROM story_entries WHERE branch_id = ?')
      .get(w.parentId) as { tail: number }
    const series = 'WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?)'
    w.sqlite.exec('BEGIN')
    try {
      w.sqlite
        .prepare(
          `${series} INSERT INTO story_entries (id, branch_id, position, kind, content, created_at)
           SELECT 'entry_bulk_' || i, ?, ? + 1 + i, 'ai_reply', 'The road runs on.', ? + i FROM n`,
        )
        .run(count - 1, w.parentId, tail, BULK_AT)
      w.sqlite
        .prepare(
          `${series} INSERT INTO deltas (id, branch_id, entry_id, action_id, log_position, source, target_table, target_id, op, undo_payload, encoding_version, created_at)
           SELECT 'delta_bulk_' || i, ?, 'entry_bulk_' || i, 'act_bulk_' || i, ? + 1 + i, 'ai_classifier', 'story_entries', 'entry_bulk_' || i, 'create', NULL, 1, ? + i FROM n`,
        )
        .run(count - 1, w.parentId, top, BULK_AT)
      w.sqlite.exec('COMMIT')
    } catch (e) {
      w.sqlite.exec('ROLLBACK')
      throw e
    }
  }

  it("leaves out an error card at the parent's tail", async () => {
    const w = await openForkWorld(2)
    await landWrites(w, { actionId: 'act_fork_world', entryId: entryAt(3) }, [
      createEntityAction(w, MIRA, 'Mira'),
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })
    const card = await writeSystemEntry(
      { branchId: w.parentId, content: 'The reply stopped short. Retry to continue.' },
      w.ctx,
    )
    const narrative = [1, 2, 3, 4, 5].map(entryAt)
    expect(entryIdsOn(w, w.parentId)).toEqual([...narrative, card])

    const { childId, facts } = await assertFork(w, entryAt(5))

    expect(facts.hasB).toBe(false)
    expect(entryIdsOn(w, childId)).toEqual(narrative)
    expect(entryIdsOn(w, w.parentId)).toEqual([...narrative, card])
  })

  it('copies every row and every delta when the fork entry is the narrative tail', async () => {
    const w = await openForkWorld(2)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, MIRA, 'Mira'),
    ])
    await landWrites(w, { actionId: 'act_fork_edit', entryId: null }, [
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: w.parentId, id: MIRA, patch: { description: 'A drover.' } },
      },
    ])
    await seedVectorsWithWindowLore(w, entryAt(5), { kind: 'entity', id: MIRA })

    const { childId, facts } = await assertFork(w, entryAt(5))

    expect(facts).toEqual({ prunedIds: [], droppedJournalIds: [], hasB: false })
    expect(idsOn(w, 'deltas', childId)).toEqual(idsOn(w, 'deltas', w.parentId))
    expect(entryIdsOn(w, childId)).toEqual(entryIdsOn(w, w.parentId))
    expect(idsOn(w, 'entities', childId)).toEqual([MIRA])
  })

  it('forks at the opening: the opening alone and the world written before the first turn', async () => {
    const w = await openForkWorld(0)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, MIRA, 'Mira', { description: 'A drover.' }),
    ])
    const beforeB = idsOn(w, 'deltas', w.parentId)
    await appendTurns(w, 2)
    await landWrites(w, { actionId: 'act_fork_late', entryId: entryAt(3) }, [
      createEntityAction(w, 'char_fork_late', 'Corin'),
    ])
    await landWrites(w, { actionId: 'act_fork_edit', entryId: null }, [
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: w.parentId,
          id: MIRA,
          patch: { description: 'A drover who knows the ford.' },
        },
      },
    ])
    await seedVectorsWithWindowLore(w, entryAt(3), { kind: 'entity', id: MIRA })

    const { childId } = await assertFork(w, entryAt(1))

    expect(entryIdsOn(w, childId)).toEqual([entryAt(1)])
    expect(idsOn(w, 'entities', childId)).toEqual([MIRA])
    expect(rowOn(w, 'entities', childId, MIRA)).toMatchObject({ description: 'A drover.' })
    expect(idsOn(w, 'deltas', childId)).toEqual(beforeB)
    expect(rowOn(w, 'entities', w.parentId, MIRA)).toMatchObject({
      description: 'A drover who knows the ford.',
    })
  })

  it('forks near the start of a window longer than the bind cap', async () => {
    const w = await openForkWorld(1)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, MIRA, 'Mira'),
    ])
    appendBulkTurns(w, BULK_TURNS)
    await seedVectorsWithWindowLore(w, 'entry_bulk_0', { kind: 'entity', id: MIRA })

    const { childId, facts } = await assertFork(w, entryAt(3))

    expect(facts.prunedIds.length).toBeGreaterThan(SQLITE_BIND_CAP)
    expect(entryIdsOn(w, childId)).toEqual([1, 2, 3].map(entryAt))
  }, 240_000)

  it('copies the vectors of the rows the child holds once rewound, and no others', async () => {
    const w = await openForkWorld(1)
    await landWrites(w, { actionId: 'act_fork_world', entryId: null }, [
      createEntityAction(w, MIRA, 'Mira'),
    ])
    await appendTurns(w, 1)
    const windowLore = await seedVectorsWithWindowLore(w, entryAt(5), {
      kind: 'entity',
      id: MIRA,
    })
    const parentBefore = vectorRows(w.sqlite, w.parentId)

    const { childId } = await assertFork(w, entryAt(3))

    const child = vectorRows(w.sqlite, childId)
    const parentAfter = vectorRows(w.sqlite, w.parentId)
    for (const dim of [4, 8]) {
      const entityTable = vecTableName('entity', dim)
      const loreTable = vecTableName('lore', dim)
      expect(
        parentBefore[entityTable]?.map(({ id }) => id),
        entityTable,
      ).toEqual([MIRA])
      expect(child[entityTable], entityTable).toEqual(parentBefore[entityTable])
      expect(child[loreTable], loreTable).toEqual([])
      expect(
        parentAfter[loreTable]?.map(({ id }) => id),
        loreTable,
      ).toEqual([windowLore])
    }
  })
})

// data-model.md → Entry mutability & rollback; data-model.md → Branch model.
describe('around a fork: CTRL-Z, redo and a fork of a fork', () => {
  const STORY = 's_fka'
  const PARENT = 'br_fka_parent'
  const GRAND = 'br_fork_grand'
  const GRAND_REF = 'br_fork_grand_ref'
  const AT = 1_767_225_600_000
  const OPENING = 'ent_fka_open'
  const U1 = 'ent_fka_u1'
  const R1 = 'ent_fka_r1'
  const U2 = 'ent_fka_u2'
  const R2 = 'ent_fka_r2'
  const U3 = 'ent_fka_u3'
  const R3 = 'ent_fka_r3'
  const ROOK = 'char_fka_rook'
  const MIRA = 'char_fka_mira'
  const HAPPENING = 'hap_fka_ford'
  const LORE = 'lore_fka_toll'
  const DELETE_ACTION = 'act_fka_delete'
  const LATE_ACTION = 'act_fka_late'

  type DeletePayload = {
    branchId: string
    relationships: { id: string; branchId: string }[]
    awareness: { id: string; branchId: string }[]
  }

  let t: Awaited<ReturnType<typeof createTestDb>>
  let ctx: DbCtx

  beforeEach(async () => {
    generationStore.__reset()
    undoRedoStore.__reset()
    t = await createTestDb()
    ctx = { db: t.db, runInTransaction: t.runInTransaction }
  })

  afterEach(() => {
    __resetBranchWriteLocks()
    entitiesStore.__reset()
    entriesStore.__reset()
    generationStore.__reset()
    undoRedoStore.__reset()
  })

  const world = (): ForkWorld => ({ ctx, sqlite: t.sqlite, storyId: STORY, parentId: PARENT })

  async function land(
    actionId: string,
    entryId: string | null,
    actions: readonly PipelineAction[],
  ): Promise<void> {
    for (const action of actions) {
      const result = await applyDeltaAction({ action, actionId, branchId: PARENT, entryId }, ctx)
      if (result.status !== 'ok')
        throw new Error(`${actionId} refused ${action.kind}: ${JSON.stringify(result)}`)
    }
  }

  const entryRow = (
    id: string,
    position: number,
    kind: 'opening' | 'user_action' | 'ai_reply',
  ): NewStoryEntry => ({
    id,
    branchId: PARENT,
    position,
    kind,
    content: `${kind} at ${position}`,
    metadata: { sceneEntities: [], currentLocationId: null, worldTime: position },
    createdAt: AT + position,
  })

  async function turn(actionId: string, user: string, reply: string, at: number): Promise<void> {
    await land(actionId, user, [
      {
        kind: 'createStoryEntry',
        source: 'user_edit',
        payload: { entry: entryRow(user, at, 'user_action') },
      },
    ])
    await land(actionId, reply, [
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: { entry: entryRow(reply, at + 1, 'ai_reply') },
      },
    ])
  }

  const character = (id: string, name: string, description: string): NewEntity => ({
    id,
    branchId: PARENT,
    kind: 'character',
    name,
    description,
    status: 'active',
    injectionMode: 'auto',
    createdAt: AT,
    updatedAt: AT,
  })

  async function seedParent(): Promise<void> {
    await ctx.db
      .insert(stories)
      .values({ id: STORY, title: 'The Ford', createdAt: AT, updatedAt: AT })
    await ctx.db
      .insert(branches)
      .values({ id: PARENT, storyId: STORY, name: 'main', createdAt: AT })
    // Story creation writes the opening and logs no delta for it.
    await ctx.db.insert(storyEntries).values(entryRow(OPENING, 1, 'opening'))
    await turn('act_fka_t1', U1, R1, 2)
    await land('act_fka_pass1', R1, [
      {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: { entry: character(ROOK, 'Rook', 'A drover who owes a debt.') },
      },
      {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: { entry: character(MIRA, 'Mira', 'A drover who knows the ford.') },
      },
      {
        kind: 'createHappening',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: HAPPENING,
            branchId: PARENT,
            title: 'The ford gives way',
            description: 'Rook goes under at the ford.',
            createdAt: AT,
            updatedAt: AT,
          },
        },
      },
      {
        kind: 'upsertHappeningAwareness',
        source: 'periodic_classifier',
        payload: {
          branchId: PARENT,
          happeningId: HAPPENING,
          characterId: ROOK,
          proseEntryId: null,
        },
      },
      {
        kind: 'upsertCharacterRelationship',
        source: 'periodic_classifier',
        payload: {
          branchId: PARENT,
          subjectId: ROOK,
          objectId: MIRA,
          kind: 'owes a debt',
          proseEntryId: null,
        },
      },
    ])
    await turn('act_fka_t2', U2, R2, 4)
    await land(DELETE_ACTION, null, [
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId: PARENT, id: ROOK } },
    ])
    await turn('act_fka_t3', U3, R3, 6)
    await land('act_fka_pass3', R3, [
      {
        kind: 'createLore',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: LORE,
            branchId: PARENT,
            title: 'The ford toll',
            body: 'Drovers pay the ferryman in salt.',
            injectionMode: 'auto',
            createdAt: AT,
            updatedAt: AT,
          },
        },
      },
    ])
  }

  const branchesHolding = (table: string, id: string): string[] =>
    (
      t.sqlite
        .prepare(`SELECT branch_id FROM ${table} WHERE id = ? ORDER BY branch_id`)
        .all(id) as {
        branch_id: string
      }[]
    ).map((row) => row.branch_id)

  function deleteOn(branchId: string): { id: string; payload: DeletePayload } {
    const row = t.sqlite
      .prepare(
        `SELECT id, undo_payload FROM deltas
         WHERE branch_id = ? AND action_id = ? AND op = 'delete' AND target_id = ?`,
      )
      .get(branchId, DELETE_ACTION, ROOK) as { id: string; undo_payload: string } | undefined
    if (row === undefined) throw new Error(`${branchId} holds no delete of ${ROOK}`)
    return { id: row.id, payload: JSON.parse(row.undo_payload) as DeletePayload }
  }

  const deltasOf = (branchId: string, actionId: string): number =>
    (
      t.sqlite
        .prepare('SELECT count(*) AS n FROM deltas WHERE branch_id = ? AND action_id = ?')
        .get(branchId, actionId) as { n: number }
    ).n

  it('CTRL-Z on the child restores a copied delete and its captured children there alone (AC 15)', async () => {
    await seedParent()
    const { childId } = await assertFork(world(), R2)
    const copied = deleteOn(childId)
    // Not vacuous: the copy's payload still names the parent, as a copy's JSON does.
    expect(copied.payload).toMatchObject({
      branchId: PARENT,
      relationships: [{ branchId: PARENT }],
      awareness: [{ branchId: PARENT }],
    })
    const relationship = copied.payload.relationships[0]!.id
    const awareness = copied.payload.awareness[0]!.id
    expect(branchesHolding('entities', ROOK)).toEqual([])
    const parentBefore = branchSnapshot(t.sqlite, PARENT)
    entriesStore.hydrate(childId, [])

    expect(await undoLastAction(childId, ctx)).toEqual({ status: 'ok' })

    expect(branchesHolding('entities', ROOK)).toEqual([childId])
    expect(branchesHolding('character_relationships', relationship)).toEqual([childId])
    expect(branchesHolding('happening_awareness', awareness)).toEqual([childId])
    expect(deltasOf(childId, DELETE_ACTION)).toBe(0)
    expect(deltasOf(PARENT, DELETE_ACTION)).toBeGreaterThan(0)
    expect(branchSnapshot(t.sqlite, PARENT)).toEqual(parentBefore)
  })

  it("leaves the parent's redo group its top and the child an empty stack (AC 16, AC 17)", async () => {
    await seedParent()
    await land(LATE_ACTION, null, [
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: PARENT,
          id: MIRA,
          patch: { description: 'A drover who swam the ford.' },
        },
      },
    ])
    entriesStore.hydrate(PARENT, [])
    expect(await undoLastAction(PARENT, ctx)).toEqual({ status: 'ok' })
    const group = undoRedoStore.peekRedoGroup(PARENT)
    expect(group?.actionId).toBe(LATE_ACTION)

    const { childId } = await assertFork(world(), R2)

    expect(undoRedoStore.peekRedoGroup(PARENT)).toBe(group)
    // Both sides: an id naming no branch would read an empty stack as well.
    expect(
      (t.sqlite.prepare('SELECT id FROM branches WHERE id = ?').get(childId) as { id: string }).id,
    ).toBe(childId)
    expect(undoRedoStore.hasRedo(PARENT)).toBe(true)
    expect(undoRedoStore.hasRedo(childId)).toBe(false)
  })

  it('a fork of a fork restores a delete whose payload names the grandparent onto the grandchild alone', async () => {
    await seedParent()
    seedForkVectors(world(), {
      created: { kind: 'lore', id: LORE },
      kept: { kind: 'entity', id: MIRA },
    })
    const { childId } = await assertFork(world(), R2)
    const copied = deleteOn(childId)
    expect(copied.payload).toMatchObject({
      branchId: PARENT,
      relationships: [{ branchId: PARENT }],
      awareness: [{ branchId: PARENT }],
    })
    const relationship = copied.payload.relationships[0]!.id
    const awareness = copied.payload.awareness[0]!.id
    // Not vacuous: the kept row's vectors reached the child, so the grandchild's copy has some.
    expect(Object.values(vectorRows(t.sqlite, childId)).flat().length).toBeGreaterThan(0)
    expect(branchesHolding('entities', ROOK)).toEqual([])
    const parentRows = branchSnapshot(t.sqlite, PARENT)
    const parentVectors = vectorRows(t.sqlite, PARENT)

    const { facts } = await assertFork({ ...world(), parentId: childId }, R1, {
      childId: GRAND,
      referenceId: GRAND_REF,
    })

    // The delete is in the grandchild's window, so its plan restores Rook from the copy's payload.
    expect(facts.prunedIds).toContain(copied.id)
    expect(branchesHolding('entities', ROOK)).toEqual([GRAND, GRAND_REF])
    expect(branchesHolding('character_relationships', relationship)).toEqual([GRAND, GRAND_REF])
    expect(branchesHolding('happening_awareness', awareness)).toEqual([GRAND, GRAND_REF])
    expect(branchSnapshot(t.sqlite, PARENT)).toEqual(parentRows)
    expect(vectorRows(t.sqlite, PARENT)).toEqual(parentVectors)
  })
})
