import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { USER_EDITED_SINCE_PROSE, type PipelineAction } from '@/lib/actions/types'
import { happeningAwareness } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { resetAllStores } from '@/lib/stores'

import { mergeHappeningsTool } from './happening-tools'
import { assertReplaySafe } from './tool'
import { markCommonKnowledgeTool } from './upkeep-tools'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import {
  charId,
  WREN,
  TOBIN,
  MARA,
  CROSSING,
  LIGHT,
  PRICE,
  TOLL,
  COMPOSITE,
  endEntryIdOf,
  BY_USER,
  byLaterTurn,
  apply,
  seedCharacter,
  seedWorld,
  happeningRow,
  involvementsOn,
  involvementId,
  awarenessOf,
  awarenessId,
  runDeltas,
  HAPPENING_TOOLS,
  runCalls,
  groupActions,
  type MergeInput,
  merge,
  NOTE,
  CLOSE_WROTE,
  NO_KEEP,
} from './__tests__/happening-tools-fixture'

describe('merge_happenings schema', () => {
  it('declares a schema the SDK replays as written', () => {
    assertReplaySafe(mergeHappeningsTool.schema, [
      { keep: 'hp1', absorb: ['hp2'], turns: ['t7'], why: 'One crossing.' },
      {
        keep: 'hp1',
        absorb: ['hp2', 'hp3'],
        title: 'The night crossing',
        description: COMPOSITE,
        turns: ['t3', 't7'],
        why: 'The same crossing, told three times.',
      },
    ])
    expect(mergeHappeningsTool.name).toBe('merge_happenings')
    expect(mergeHappeningsTool.ids).toEqual({
      keep: { shape: 'single', prefixes: ['hap_'] },
      absorb: { shape: 'array', prefixes: ['hap_'] },
    })
  })

  it('tells the model to merge one event in one call, never in a chain', () => {
    expect(mergeHappeningsTool.description).toContain(
      'Merge everything that records one event in one call; never in a chain.',
    )
  })
})

describe('merge_happenings refusals', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedWorld(f)
  })

  afterEach(() => {
    resetAllStores()
  })

  it.each<{ name: string; args: MergeInput; reason: string }>([
    {
      name: 'an empty absorb',
      args: { keep: 'hp1', absorb: [] },
      reason: 'absorb is empty: name the happenings to fold into keep',
    },
    {
      name: 'keep inside absorb',
      args: { keep: 'hp1', absorb: ['hp1', 'hp2'] },
      reason: 'keep is also in absorb: keep one happening and absorb the others',
    },
    {
      name: 'a repeated id',
      args: { keep: 'hp1', absorb: ['hp2', 'hp2'] },
      reason: 'absorb names a happening twice: name each happening once',
    },
    {
      name: "a row outside keep's cluster",
      args: { keep: 'hp1', absorb: ['hp4'] },
      reason:
        "absorb names a happening outside keep's cluster: merge only happenings listed in one cluster",
    },
  ])('rejects $name, writing nothing', async ({ args, reason }) => {
    const run = await runCalls(f, [merge(args)])

    expect(run.answers).toEqual([{ result: 'rejected', reason }])
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]).toMatchObject({ result: 'rejected', reason })
    expect(run.calls[0]).not.toHaveProperty('survivor')
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('rejects an absorbed row that is gone, writing nothing', async () => {
    await apply(
      f,
      {
        kind: 'deleteHappening',
        source: 'user_edit',
        payload: { branchId: f.branchId, id: LIGHT },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([{ result: 'rejected', reason: 'row-gone', note: NOTE.gone }])
    expect(run.calls[0]).toMatchObject({
      result: 'rejected',
      reason: 'row-gone',
      rows: [
        { table: 'happenings', id: CROSSING, name: 'Tobin poles Wren across' },
        { table: 'happenings', id: LIGHT, name: 'A light on the far bank' },
      ],
    })
    expect(run.calls[0]).not.toHaveProperty('survivor')
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('rejects a row an earlier merge absorbed, naming the row it went into', async () => {
    const run = await runCalls(f, [
      merge({ keep: 'hp1', absorb: ['hp2'] }),
      merge({ keep: 'hp3', absorb: ['hp2'] }),
    ])

    expect(run.answers[0]).toEqual({ result: 'ok', survivor: 'hp1' })
    expect(run.answers[1]).toEqual({
      result: 'rejected',
      reason: 'row-gone',
      note: 'The row was merged into hp1; write to hp1 instead.',
      survivor: 'hp1',
    })
    expect(run.calls[1]).toMatchObject({ result: 'rejected', reason: 'row-gone' })
    expect(run.calls[1]).not.toHaveProperty('survivor')
    expect(await happeningRow(f, PRICE)).toBeDefined()
  })

  it('rejects absorbing a kept row an earlier merge in this close created a link on, saying to keep it', async () => {
    const run = await runCalls(f, [
      // No text, and PRICE's anchor equals CROSSING's: this merge writes only CROSSING's links.
      merge({ keep: 'hp1', absorb: ['hp3'] }),
      merge({ keep: 'hp2', absorb: ['hp1'] }),
    ])

    const written = await runDeltas(f, run.result.actionId)
    expect(
      written.filter(
        ({ targetTable, targetId }) => targetTable === 'happenings' && targetId === CROSSING,
      ),
    ).toEqual([])
    const maraOnCrossing = await involvementId(f, CROSSING, MARA)
    expect(written.some(({ targetId }) => targetId === maraOnCrossing)).toBe(true)

    expect(run.answers[1]).toEqual({
      result: 'rejected',
      reason: CLOSE_WROTE,
      note: 'Send hp1 as keep.',
    })
    expect(run.calls[1]).toMatchObject({ result: 'rejected', reason: CLOSE_WROTE })
    expect(run.calls[1]).not.toHaveProperty('survivor')
    expect(written.filter(({ targetId }) => targetId === LIGHT)).toEqual([])
    expect(await happeningRow(f, LIGHT)).toBeDefined()
    expect(await happeningRow(f, CROSSING)).toBeDefined()
  })

  it('lands a merge that keeps the row an earlier merge in this close wrote a link on', async () => {
    const run = await runCalls(f, [
      merge({ keep: 'hp1', absorb: ['hp3'] }),
      merge({ keep: 'hp1', absorb: ['hp2'] }),
    ])

    expect(run.answers).toEqual([
      { result: 'ok', survivor: 'hp1' },
      { result: 'ok', survivor: 'hp1' },
    ])
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
    expect(await happeningRow(f, PRICE)).toBeUndefined()
  })

  it('rejects a merge among two rows this close wrote, with no keep to suggest', async () => {
    const run = await runCalls(
      f,
      [
        merge({ keep: 'hp1', absorb: ['hp3'] }),
        {
          toolName: 'mark_common_knowledge',
          input: { id: 'hp2', turns: ['t7'], why: 'Word of the light spread to everyone.' },
        },
        merge({ keep: 'hp1', absorb: ['hp2'] }),
      ],
      { ...HAPPENING_TOOLS, mark_common_knowledge: markCommonKnowledgeTool },
    )

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect(run.answers[2]).toEqual({ result: 'rejected', reason: NO_KEEP })
    expect(run.calls[2]).not.toHaveProperty('survivor')
    expect(await happeningRow(f, LIGHT)).toBeDefined()
  })

  it("skips the whole merge when a later turn wrote an absorbed row's awareness", async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: LIGHT,
          decayResistance: 0.9,
          proseEntryId: null,
        },
      },
      byLaterTurn(f),
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'], description: COMPOSITE })])

    expect(run.answers).toEqual([{ result: 'skipped', reason: 'later-turn', note: NOTE.laterTurn }])
    expect(run.calls[0]).toMatchObject({
      result: 'skipped',
      reason: 'later-turn',
      values: { description: COMPOSITE },
    })
    expect(run.calls[0]).not.toHaveProperty('survivor')
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await happeningRow(f, LIGHT)).toBeDefined()
  })

  it("skips the whole merge when a later turn wrote any field of keep's own row", async () => {
    await apply(
      f,
      {
        kind: 'updateHappening',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          id: CROSSING,
          patch: { icon: 'lantern' },
          proseEntryId: null,
        },
      },
      byLaterTurn(f),
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'] })])

    expect(run.answers).toEqual([{ result: 'skipped', reason: 'later-turn', note: NOTE.laterTurn }])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await happeningRow(f, PRICE)).toBeDefined()
  })

  it('still merges a row whose only later write is a retrieval bump', async () => {
    const lightWren = await awarenessId(f, LIGHT, WREN)
    await apply(
      f,
      {
        kind: 'bumpAwarenessRetrieval',
        source: 'ai_classifier',
        payload: { branchId: f.branchId, id: lightWren, priorCount: 3 },
      },
      byLaterTurn(f),
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    // CROSSING's 2 and LIGHT's bumped 4.
    expect((await awarenessOf(f, CROSSING, WREN))?.retrievalCount).toBe(6)
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
  })

  it("skips the whole merge when the user wrote an absorbed row's involvement for a character keep also has", async () => {
    const tobinOnLight = await involvementId(f, LIGHT, TOBIN)
    await apply(
      f,
      {
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: f.branchId, id: tobinOnLight, patch: { role: 'lookout' } },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: NOTE.user },
    ])
    expect(run.calls[0]).not.toHaveProperty('survivor')
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await involvementsOn(f, LIGHT)).toContain(`${TOBIN}:lookout`)
  })

  it.each<{ name: string; removed: (fx: CloseFixture) => Promise<PipelineAction> }>([
    {
      name: "Mara's awareness",
      removed: async (fx) => ({
        kind: 'deleteHappeningAwareness',
        source: 'user_edit',
        payload: { branchId: fx.branchId, id: await awarenessId(fx, LIGHT, MARA) },
      }),
    },
    {
      name: "Mara's involvement",
      removed: async (fx) => ({
        kind: 'deleteHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: fx.branchId, id: await involvementId(fx, LIGHT, MARA) },
      }),
    },
    {
      name: 'Mara with her links',
      removed: async (fx) => ({
        kind: 'deleteEntity',
        source: 'user_edit',
        payload: { branchId: fx.branchId, id: MARA },
      }),
    },
  ])(
    'skips the whole merge when the user deleted $name on an absorbed row',
    async ({ removed }) => {
      await apply(f, await removed(f), BY_USER)

      const run = await runCalls(f, [
        merge({ keep: 'hp1', absorb: ['hp2'], description: COMPOSITE }),
      ])

      expect(run.answers).toEqual([
        { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: NOTE.user },
      ])
      expect(run.calls[0]).toMatchObject({
        result: 'skipped',
        reason: USER_EDITED_SINCE_PROSE,
        values: { description: COMPOSITE },
      })
      expect(run.calls[0]).not.toHaveProperty('survivor')
      expect(await runDeltas(f, run.result.actionId)).toEqual([])
      expect(await happeningRow(f, LIGHT)).toBeDefined()
    },
  )

  it("skips the whole merge when the user wrote a field of keep's the merge writes", async () => {
    await apply(
      f,
      {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          id: CROSSING,
          patch: { description: 'The user tells it this way.' },
          proseEntryId: null,
        },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'], description: COMPOSITE })])

    expect(run.answers).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: NOTE.user },
    ])
    expect((await happeningRow(f, CROSSING))?.description).toBe('The user tells it this way.')
    expect(await happeningRow(f, PRICE)).toBeDefined()
  })

  it("lands a merge writing only keep's description over the user's edit of its icon", async () => {
    await apply(
      f,
      {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          id: CROSSING,
          patch: { icon: 'boat' },
          proseEntryId: null,
        },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'], description: COMPOSITE })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(await happeningRow(f, CROSSING)).toMatchObject({ description: COMPOSITE, icon: 'boat' })
    expect(await happeningRow(f, PRICE)).toBeUndefined()
  })

  it('rejects a composite holding a turn id, writing nothing', async () => {
    const run = await runCalls(f, [
      merge({
        keep: 'hp1',
        absorb: ['hp2'],
        description: 'At t3 a light moves on the far bank, then Tobin poles Wren across.',
      }),
    ])

    expect(run.answers).toEqual([
      { result: 'rejected', reason: 't3 is a turn: cite turns in turns, never in the text' },
    ])
    expect(run.calls[0]).not.toHaveProperty('survivor')
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it.each<{ name: string; link: (branchId: string) => PipelineAction }>([
    {
      name: 'an involvement',
      link: (branchId) => ({
        kind: 'createHappeningInvolvement',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: generateId('hinv'),
            branchId,
            happeningId: TOLL,
            entityId: MARA,
            role: 'ferry hand',
          },
        },
      }),
    },
    {
      name: 'an awareness row',
      link: (branchId) => ({
        kind: 'upsertHappeningAwareness',
        source: 'periodic_classifier',
        payload: {
          branchId,
          characterId: MARA,
          happeningId: TOLL,
          learnedAtEntryId: null,
          decayResistance: 0.6,
          source: 'Mara paid the toll',
          proseEntryId: null,
        },
      }),
    },
  ])(
    'rejects absorbing a kept row whose only write this close was $name a merge carried onto it',
    async ({ link }) => {
      const seeded = link(f.branchId)
      await apply(f, seeded)

      // TOLL's anchor is later than CROSSING's and neither has text to send: the first merge
      // writes one link on CROSSING and deletes TOLL.
      const run = await runCalls(
        f,
        [merge({ keep: 'hp1', absorb: ['hp4'] }), merge({ keep: 'hp2', absorb: ['hp1'] })],
        HAPPENING_TOOLS,
        [[LIGHT, CROSSING, TOLL]],
      )

      expect(run.answers[0]).toEqual({ result: 'ok', survivor: 'hp1' })
      expect(
        groupActions(run)
          .filter(({ kind }) => kind !== 'deleteHappening')
          .map(({ kind }) => kind),
      ).toEqual([seeded.kind])
      expect(run.answers[1]).toEqual({
        result: 'rejected',
        reason: CLOSE_WROTE,
        note: 'Send hp1 as keep.',
      })
      expect(await happeningRow(f, CROSSING)).toBeDefined()
    },
  )

  it("rejects a keep in no cluster as absorbing rows outside keep's cluster", async () => {
    const run = await runCalls(f, [merge({ keep: 'hp4', absorb: ['hp1'] })])

    expect(run.answers).toEqual([
      {
        result: 'rejected',
        reason:
          "absorb names a happening outside keep's cluster: merge only happenings listed in one cluster",
      },
    ])
    expect(await happeningRow(f, CROSSING)).toBeDefined()
  })

  it("skips the whole merge when a later turn wrote keep's own awareness pair", async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: CROSSING,
          decayResistance: 0.9,
          proseEntryId: null,
        },
      },
      byLaterTurn(f),
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([{ result: 'skipped', reason: 'later-turn', note: NOTE.laterTurn }])
    expect(await happeningRow(f, LIGHT)).toBeDefined()
  })

  it.each<{ field: 'title' | 'description' }>([{ field: 'title' }, { field: 'description' }])(
    "lands a merge restating the $field the user gave keep, writing none of keep's text",
    async ({ field }) => {
      const users = field === 'title' ? 'The crossing, as the user names it' : COMPOSITE
      await apply(
        f,
        {
          kind: 'updateHappening',
          source: 'user_edit',
          payload: {
            branchId: f.branchId,
            id: CROSSING,
            patch: { [field]: users },
            proseEntryId: null,
          },
        },
        BY_USER,
      )

      const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'], [field]: users })])

      expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
      expect((await happeningRow(f, CROSSING))?.[field]).toBe(users)
      expect(await happeningRow(f, PRICE)).toBeUndefined()
    },
  )

  it('rejects a composite title holding a turn id, writing nothing', async () => {
    const run = await runCalls(f, [
      merge({ keep: 'hp1', absorb: ['hp2'], title: 'The t3 crossing' }),
    ])

    expect(run.answers).toEqual([
      { result: 'rejected', reason: 't3 is a turn: cite turns in turns, never in the text' },
    ])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('rejects a shape fault ahead of a gone row', async () => {
    await apply(
      f,
      { kind: 'deleteHappening', source: 'user_edit', payload: { branchId: f.branchId, id: TOLL } },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp4'] })])

    expect(run.answers).toEqual([
      {
        result: 'rejected',
        reason:
          "absorb names a happening outside keep's cluster: merge only happenings listed in one cluster",
      },
    ])
  })

  it('rejects absorbing a row this close wrote ahead of a later turn touching the merge', async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: LIGHT,
          decayResistance: 0.9,
          proseEntryId: null,
        },
      },
      byLaterTurn(f),
    )

    const run = await runCalls(f, [
      merge({ keep: 'hp1', absorb: ['hp3'] }),
      merge({ keep: 'hp2', absorb: ['hp1'] }),
    ])

    expect(run.answers).toEqual([
      { result: 'ok', survivor: 'hp1' },
      { result: 'rejected', reason: CLOSE_WROTE, note: 'Send hp1 as keep.' },
    ])
  })

  it('skips a merge a later turn touched ahead of a turn id in its composite', async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: LIGHT,
          decayResistance: 0.9,
          proseEntryId: null,
        },
      },
      byLaterTurn(f),
    )

    const run = await runCalls(f, [
      merge({
        keep: 'hp1',
        absorb: ['hp2'],
        description: 'At t3 a light moves on the far bank, then Tobin poles Wren across.',
      }),
    ])

    expect(run.answers).toEqual([{ result: 'skipped', reason: 'later-turn', note: NOTE.laterTurn }])
  })

  it("names a later turn's write ahead of the user's when both touched the merge", async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: LIGHT,
          decayResistance: 0.9,
          proseEntryId: null,
        },
      },
      byLaterTurn(f),
    )
    await apply(
      f,
      {
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          id: await involvementId(f, LIGHT, TOBIN),
          patch: { role: 'lookout' },
        },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([{ result: 'skipped', reason: 'later-turn', note: NOTE.laterTurn }])
  })
})

describe('merge_happenings shape', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedWorld(f)
  })

  afterEach(() => {
    resetAllStores()
  })

  it('lands one group: the composite and the earliest anchor on keep, links folded once, absorbed rows deleted', async () => {
    const run = await runCalls(f, [
      merge({
        keep: 'hp1',
        absorb: ['hp2', 'hp3'],
        title: 'The night crossing',
        description: COMPOSITE,
      }),
    ])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(await happeningRow(f, CROSSING)).toMatchObject({
      title: 'The night crossing',
      description: COMPOSITE,
      // LIGHT's t3 is the earliest of the three.
      occurredAtEntryId: f.entries[2]!.id,
      commonKnowledge: 0,
    })
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
    expect(await happeningRow(f, PRICE)).toBeUndefined()

    // Mara is involved in both absorbed rows: one create, with LIGHT's role.
    expect(await involvementsOn(f, CROSSING)).toEqual(
      [`${MARA}:watcher`, `${TOBIN}:ferryman`, `${WREN}:passenger`].sort(),
    )
    expect(await involvementsOn(f, LIGHT)).toEqual([])
    expect(await involvementsOn(f, PRICE)).toEqual([])

    // Wren knows all three: max 0.7, earliest t3, 2 + 3 + 4, PRICE's source a repeat of keep's.
    expect(await awarenessOf(f, CROSSING, WREN)).toMatchObject({
      learnedAtEntryId: f.entries[2]!.id,
      decayResistance: 0.7,
      retrievalCount: 9,
      source: 'Wren crossed with Tobin; Wren saw the light',
    })
    // Only keep knew of Tobin's: untouched.
    expect(await awarenessOf(f, CROSSING, TOBIN)).toMatchObject({
      learnedAtEntryId: f.entries[4]!.id,
      decayResistance: 0.3,
      retrievalCount: 0,
      source: 'Tobin poled the boat',
    })
    // Mara, created on keep from the two absorbed rows: one row, LIGHT's earlier anchor.
    expect(await awarenessOf(f, CROSSING, MARA)).toMatchObject({
      learnedAtEntryId: f.entries[2]!.id,
      decayResistance: 0.2,
      retrievalCount: 3,
      source: 'Mara heard the haggling',
    })

    const written = await runDeltas(f, run.result.actionId)
    for (const delta of written)
      expect(delta).toMatchObject({ source: 'chapter_close', entryId: endEntryIdOf(f) })
    expect(
      written
        .filter(({ targetTable, op }) => targetTable === 'happenings' && op === 'delete')
        .map(({ targetId }) => targetId)
        .sort(),
    ).toEqual([LIGHT, PRICE].sort())

    expect(run.calls).toEqual([
      {
        task: 'happenings',
        part: 0,
        tool: 'merge_happenings',
        rows: [
          { table: 'happenings', id: CROSSING, name: 'Tobin poles Wren across' },
          { table: 'happenings', id: LIGHT, name: 'A light on the far bank' },
          { table: 'happenings', id: PRICE, name: 'Tobin names his price' },
        ],
        why: 'The turns tell one crossing.',
        turns: [endEntryIdOf(f)],
        result: 'ok',
        values: { title: 'The night crossing', description: COMPOSITE },
        survivor: { table: 'happenings', id: CROSSING },
      },
    ])
  })

  it("lands a redundant-row merge with keep's text standing and no write to keep's row", async () => {
    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(await happeningRow(f, CROSSING)).toMatchObject({
      title: 'Tobin poles Wren across',
      description: 'Tobin takes Wren over the river at night.',
      occurredAtEntryId: f.entries[4]!.id,
    })
    expect(await happeningRow(f, PRICE)).toBeUndefined()
    expect(await involvementsOn(f, CROSSING)).toEqual(
      [`${MARA}:onlooker`, `${TOBIN}:ferryman`, `${WREN}:passenger`].sort(),
    )
    expect(await awarenessOf(f, CROSSING, WREN)).toMatchObject({
      learnedAtEntryId: f.entries[4]!.id,
      decayResistance: 0.5,
      retrievalCount: 6,
      source: 'Wren crossed with Tobin',
    })
    const written = await runDeltas(f, run.result.actionId)
    expect(
      written.filter(
        ({ targetTable, targetId }) => targetTable === 'happenings' && targetId === CROSSING,
      ),
    ).toEqual([])
    expect(run.calls[0]).not.toHaveProperty('values')
    expect(run.calls[0]).toMatchObject({
      result: 'ok',
      survivor: { table: 'happenings', id: CROSSING },
    })
    // PRICE's anchor equals keep's, so keep's row gets no update; Wren's pair sends what differs.
    const sent = groupActions(run)
    expect(sent.filter(({ kind }) => kind === 'updateHappening')).toEqual([])
    expect(
      sent.find(
        (action) =>
          action.kind === 'upsertHappeningAwareness' && action.payload.characterId === WREN,
      )?.payload,
    ).toEqual({
      branchId: f.branchId,
      characterId: WREN,
      happeningId: CROSSING,
      decayResistance: 0.5,
      retrievalCount: 6,
      proseEntryId: endEntryIdOf(f),
    })
  })

  it("folds an absorbed awareness row's learned_at onto keep's when no merged happening is anchored there", async () => {
    // t4 anchors neither CROSSING nor PRICE, so only the awareness rows' anchors place it.
    await f.ctx.db
      .update(happeningAwareness)
      .set({ learnedAtEntryId: f.entries[3]!.id })
      .where(eq(happeningAwareness.id, await awarenessId(f, PRICE, WREN)))
    expect((await awarenessOf(f, CROSSING, WREN))?.learnedAtEntryId).toBe(f.entries[4]!.id)

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect((await awarenessOf(f, CROSSING, WREN))?.learnedAtEntryId).toBe(f.entries[3]!.id)
  })

  it('leaves an involvement the user removed from keep removed, naming its character', async () => {
    const tobinOnCrossing = await involvementId(f, CROSSING, TOBIN)
    await apply(
      f,
      {
        kind: 'deleteHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: f.branchId, id: tobinOnCrossing },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([
      {
        result: 'ok',
        survivor: 'hp1',
        notWritten: [
          { field: 'entityId', row: 'c2', reason: USER_EDITED_SINCE_PROSE, note: NOTE.user },
        ],
      },
    ])
    expect(await involvementsOn(f, CROSSING)).toEqual(
      [`${MARA}:watcher`, `${WREN}:passenger`].sort(),
    )
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
  })

  it("keeps the user's value on keep's own awareness row while the merge lands, naming its character", async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: CROSSING,
          decayResistance: 0.1,
          proseEntryId: null,
        },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([
      {
        result: 'ok',
        survivor: 'hp1',
        notWritten: [
          {
            field: 'decayResistance',
            row: 'c1',
            reason: USER_EDITED_SINCE_PROSE,
            note: NOTE.user,
          },
        ],
      },
    ])
    expect(await awarenessOf(f, CROSSING, WREN)).toMatchObject({
      decayResistance: 0.1,
      learnedAtEntryId: f.entries[2]!.id,
      retrievalCount: 5,
      source: 'Wren crossed with Tobin; Wren saw the light',
    })
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
    // The handler would keep the user's value silently; the plan doesn't send it.
    const wrenUpsert = groupActions(run).find(
      (action) => action.kind === 'upsertHappeningAwareness' && action.payload.characterId === WREN,
    )
    expect(wrenUpsert?.payload).not.toHaveProperty('decayResistance')
  })

  it('lands a composite past the bounds bounded', async () => {
    const run = await runCalls(f, [
      merge({
        keep: 'hp1',
        absorb: ['hp3'],
        title: 'L'.repeat(200),
        description: 'x'.repeat(1_500),
      }),
    ])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(await happeningRow(f, CROSSING)).toMatchObject({
      title: 'L'.repeat(120),
      description: 'x'.repeat(1_200),
    })
    expect(run.calls[0]?.values).toEqual({ title: 'L'.repeat(120), description: 'x'.repeat(1_200) })
  })

  it('marks keep common knowledge when an absorbed row is, through the real handler', async () => {
    await apply(f, {
      kind: 'updateHappening',
      source: 'periodic_classifier',
      payload: {
        branchId: f.branchId,
        id: PRICE,
        patch: { commonKnowledge: 1 },
        proseEntryId: null,
      },
    })

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect((await happeningRow(f, CROSSING))?.commonKnowledge).toBe(1)
  })

  it('shows a character only an absorbed row names with its name, ahead of its handle', async () => {
    const odo = charId(4)
    await seedCharacter(f, odo, 'Odo')
    await apply(f, {
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: {
        branchId: f.branchId,
        characterId: odo,
        happeningId: LIGHT,
        learnedAtEntryId: f.entries[2]!.id,
        decayResistance: 0.3,
        source: 'Odo saw the light from the mill',
        proseEntryId: null,
      },
    })

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(run.ids.nameOfId(odo)).toBe('Odo')
    expect(await awarenessOf(f, CROSSING, odo)).toMatchObject({
      source: 'Odo saw the light from the mill',
    })
  })

  it('names a character whose awareness of keep the user deleted by characterId, and leaves it deleted', async () => {
    await apply(
      f,
      {
        kind: 'deleteHappeningAwareness',
        source: 'user_edit',
        payload: { branchId: f.branchId, id: await awarenessId(f, CROSSING, WREN) },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([
      {
        result: 'ok',
        survivor: 'hp1',
        notWritten: [
          { field: 'characterId', row: 'c1', reason: USER_EDITED_SINCE_PROSE, note: NOTE.user },
        ],
      },
    ])
    expect(await awarenessOf(f, CROSSING, WREN)).toBeUndefined()
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
  })

  it('sends keep no common knowledge it already has', async () => {
    for (const id of [CROSSING, PRICE])
      await apply(f, {
        kind: 'updateHappening',
        source: 'periodic_classifier',
        payload: { branchId: f.branchId, id, patch: { commonKnowledge: 1 }, proseEntryId: null },
      })

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp3'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(groupActions(run).filter(({ kind }) => kind === 'updateHappening')).toEqual([])
  })
})
