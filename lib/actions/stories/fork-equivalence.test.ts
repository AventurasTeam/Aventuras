import { afterEach, describe, expect, it } from 'vitest'

import { resetAllStores } from '@/lib/stores'

import type { PipelineAction } from '../types'
import {
  appendTurns,
  assertFork,
  createEntityAction,
  createHappeningAction,
  entryAt,
  landWrites,
  openForkWorld,
  rowOn,
  rowsOn,
  seedVectorsWithWindowLore,
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
