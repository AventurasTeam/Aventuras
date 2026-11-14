import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { USER_EDITED_SINCE_PROSE } from '@/lib/actions/types'
import { happeningAwareness } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import {
  charId,
  WREN,
  TOBIN,
  MARA,
  CROSSING,
  LIGHT,
  PRICE,
  COMPOSITE,
  endEntryIdOf,
  BY_USER,
  apply,
  seedCharacter,
  seedWorld,
  happeningRow,
  involvementsOn,
  involvementId,
  awarenessOf,
  awarenessId,
  runDeltas,
  runCalls,
  groupActions,
  merge,
  NOTE,
  pinByUser,
  rewriteCitedProse,
} from './__tests__/happening-tools-fixture'

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

  it("keeps a pin the user set on keep's own row before the cited turn while the merge lands, naming its character", async () => {
    await pinByUser(f, CROSSING, WREN, 0.1)
    await rewriteCitedProse(f)

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
    // The fold's other fields still land: only the pin is the user's whatever turn is cited.
    expect(await awarenessOf(f, CROSSING, WREN)).toMatchObject({
      decayResistance: 0.1,
      learnedAtEntryId: f.entries[2]!.id,
      retrievalCount: 5,
    })
    expect(await happeningRow(f, LIGHT)).toBeUndefined()
  })

  it("folds a source the user wrote on keep's own row before the cited turn", async () => {
    await apply(
      f,
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          characterId: WREN,
          happeningId: CROSSING,
          source: 'Wren rode the ferry',
          proseEntryId: null,
        },
      },
      BY_USER,
    )
    await rewriteCitedProse(f)

    const run = await runCalls(f, [merge({ keep: 'hp1', absorb: ['hp2'] })])

    expect(run.answers).toEqual([{ result: 'ok', survivor: 'hp1' }])
    expect((await awarenessOf(f, CROSSING, WREN))?.source).toBe(
      'Wren rode the ferry; Wren saw the light',
    )
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
