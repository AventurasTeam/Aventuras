import { afterEach, describe, expect, it } from 'vitest'

import {
  assets,
  emptyEntityState,
  vecTableName,
  type CharacterState,
  type NewEntity,
} from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { writeSystemEntry } from '../story-entries/system-entry'
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
    // Anchored before the fork entry, so the window spares it; an unanchored write would go.
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

  it('keeps the entry_assets row on a kept entry and drops the one on a removed entry', async () => {
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

  // Entries after the tail and their create deltas, in raw SQL: the action layer would take minutes.
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
