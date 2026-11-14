import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { USER_EDITED_SINCE_PROSE, type PipelineAction } from '@/lib/actions/types'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { resetAllStores } from '@/lib/stores'

import { mergeHappeningsTool } from './happening-tools'
import { CloseLedgerWriter } from './ledger'
import { assertReplaySafe } from './tool'
import { markCommonKnowledgeTool } from './upkeep-tools'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import {
  WREN,
  TOBIN,
  MARA,
  CROSSING,
  LIGHT,
  PRICE,
  TOLL,
  COMPOSITE,
  BY_USER,
  byLaterTurn,
  apply,
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
  OUTSIDE_CLUSTER,
  pinByUser,
  rewriteCitedProse,
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

  it.each<{ name: string; args: MergeInput; key: string; reason: string }>([
    {
      name: 'an empty absorb',
      args: { keep: 'hp1', absorb: [] },
      key: 'merge-absorb-empty',
      reason: 'merge-absorb-empty: absorb is empty: name the happenings to fold into keep',
    },
    {
      name: 'keep inside absorb',
      args: { keep: 'hp1', absorb: ['hp1', 'hp2'] },
      key: 'merge-keep-absorbed',
      reason:
        'merge-keep-absorbed: keep is also in absorb: keep one happening and absorb the others',
    },
    {
      name: 'a repeated id',
      args: { keep: 'hp1', absorb: ['hp2', 'hp2'] },
      key: 'merge-repeated',
      reason: 'merge-repeated: absorb names a happening twice: name each happening once',
    },
    {
      name: "a row outside keep's cluster",
      args: { keep: 'hp1', absorb: ['hp4'] },
      key: 'merge-outside-cluster',
      reason: OUTSIDE_CLUSTER,
    },
  ])('rejects $name, writing nothing', async ({ args, key, reason }) => {
    const run = await runCalls(f, [merge(args)])

    expect(run.answers).toEqual([{ result: 'rejected', reason }])
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]).toMatchObject({ result: 'rejected', reason: key })
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
    expect(run.calls[1]).toMatchObject({ result: 'rejected', reason: 'merge-close-wrote' })
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
    expect(run.calls[2]).toMatchObject({ result: 'rejected', reason: 'merge-close-wrote-no-keep' })
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

  // Raised, the pin would move to a row the close writes, where set_pin no longer sees it as
  // theirs; lowered, keep's higher pin would replace it.
  it.each([
    { change: 'raised', characterId: MARA, pin: 0.9 },
    { change: 'lowered', characterId: WREN, pin: 0.05 },
  ])(
    'skips the whole merge when the user $change a pin on an absorbed row before the cited turn',
    async ({ characterId, pin }) => {
      await pinByUser(f, LIGHT, characterId, pin)
      await rewriteCitedProse(f)

      const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

      expect(run.answers).toEqual([
        { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: NOTE.user },
      ])
      expect(await runDeltas(f, run.result.actionId)).toEqual([])
      expect((await awarenessOf(f, LIGHT, characterId))?.decayResistance).toBe(pin)
    },
  )

  it("still merges an absorbed row whose only user edit before the cited turn isn't its pin", async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: LIGHT,
          source: 'Wren saw it go out',
          proseEntryId: null,
        },
      },
      BY_USER,
    )
    await rewriteCitedProse(f)

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
  })

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
      {
        result: 'rejected',
        reason: 'turn-in-text: t3 is a turn: cite turns in turns, never in the text',
      },
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
        reason: OUTSIDE_CLUSTER,
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
      {
        result: 'rejected',
        reason: 'turn-in-text: t3 is a turn: cite turns in turns, never in the text',
      },
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
        reason: OUTSIDE_CLUSTER,
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

describe('merge_happenings values', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedWorld(f)
    // LIGHT, at t3 ahead of CROSSING's t5, is common knowledge; CROSSING isn't.
    await apply(f, {
      kind: 'updateHappening',
      source: 'periodic_classifier',
      payload: {
        branchId: f.branchId,
        id: LIGHT,
        patch: { commonKnowledge: 1 },
        proseEntryId: null,
      },
    })
  })

  afterEach(() => {
    resetAllStores()
    vi.restoreAllMocks()
  })

  it('records the anchor and common knowledge a merge lands on keep beside its text, each logged', async () => {
    const debug = vi.spyOn(logger, 'debug')

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'], description: COMPOSITE })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect(await happeningRow(f, CROSSING)).toMatchObject({
      occurredAtEntryId: f.entries[2]!.id,
      commonKnowledge: 1,
    })
    expect(run.calls[0]!.values).toEqual({
      description: COMPOSITE,
      occurredAtEntryId: f.entries[2]!.id,
      commonKnowledge: '1',
    })
    const logged = debug.mock.calls
      .filter(([event]) => event === 'memory.close_report_value')
      .map(([, data]) => (data as { path: string }).path)
    expect(logged).toEqual(['description', 'occurredAtEntryId', 'commonKnowledge'])
  })

  it("lists the derived fields in a later task's writes so far", async () => {
    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'], description: COMPOSITE })])
    const ledger = { calls: run.calls, stopped: [], noToolCalls: false }
    const writer = new CloseLedgerWriter(ledger, (id) => run.ids.nameOfId(id), run.result.actionId)

    expect(writer.writesSoFar(run.ids)).toBe(
      '- merge_happenings Tobin poles Wren across (hp1), A light on the far bank (hp2): description, occurredAtEntryId, commonKnowledge; kept hp1',
    )
  })

  it('records them as proposed on a merge the user skipped', async () => {
    await apply(
      f,
      {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: { branchId: f.branchId, id: LIGHT, patch: { icon: 'lamp' }, proseEntryId: null },
      },
      BY_USER,
    )

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(run.calls[0]!.values).toEqual({
      occurredAtEntryId: f.entries[2]!.id,
      commonKnowledge: '1',
    })
  })
})
