import { describe, expect, it } from 'vitest'

import { TARGET_NOT_FOUND } from '@/lib/actions/delta/registry'
import {
  USER_EDITED_SINCE_PROSE,
  type ActionOutcome,
  type GroupOutcome,
  type NoopMark,
} from '@/lib/actions/types'

import { CloseIds } from './ids'
import type { PlannedAction, WritePlan } from './tool'
import { CLOSE_REASON, modelAnswer, verdictOf } from './verdict'

const BRANCH = 'br_close'
const LORE_A = 'lore_11111111-1111-4111-8111-111111111111'
const LORE_KEPT = 'lore_22222222-2222-4222-8222-222222222222'
const CHAR_A = 'char_33333333-3333-4333-8333-333333333333'
const LORE_B = 'lore_44444444-4444-4444-8444-444444444444'
const LORE_OTHER = 'lore_55555555-5555-4555-8555-555555555555'

type Plan = Extract<WritePlan, { kind: 'write' }>

const loreUpdate = (
  patch: { title?: string; body?: string; keywords?: string[] },
  fields: readonly string[],
  id = LORE_A,
): PlannedAction => ({
  action: {
    kind: 'updateLore',
    source: 'chapter_close',
    payload: { branchId: BRANCH, id, patch },
  },
  fields,
})
const BODY = loreUpdate({ body: 'Tolls double after dark.' }, ['body'])
const TITLE = loreUpdate({ title: 'The night toll' }, ['title'])

function writePlan(over: Partial<Plan> = {}): Plan {
  return {
    kind: 'write',
    actions: [],
    lost: [],
    rows: [{ table: 'lore', id: LORE_A, name: 'The toll law' }],
    values: {},
    ...over,
  }
}

const landed: ActionOutcome = { status: 'landed' }
const noop = (reason: string, mark?: NoopMark): ActionOutcome =>
  mark === undefined ? { status: 'noop', reason } : { status: 'noop', reason, mark }
const group = (...outcomes: ActionOutcome[]): GroupOutcome => ({ status: 'ok', outcomes })
const noMerges = { survivorOf: () => undefined }
const mergedIntoKept = {
  survivorOf: (table: string, id: string) =>
    table === 'lore' && id === LORE_A ? { table: 'lore', id: LORE_KEPT } : undefined,
}

describe("verdictOf, by C11's table", () => {
  it('a value already stored is ok with nothing written', () => {
    expect(
      verdictOf(
        writePlan({ actions: [BODY] }),
        group(noop('body unchanged', 'restated')),
        noMerges,
      ),
    ).toEqual({ result: 'ok', landed: [], skippedFields: [] })
  })

  it('a row that went is rejected as row-gone', () => {
    const gone = noop(`keyword target lore ${BRANCH}:${LORE_A} not found`, 'gone')
    expect(verdictOf(writePlan({ actions: [BODY] }), group(gone), noMerges)).toEqual({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      landed: [],
      skippedFields: [],
    })
  })

  it('a row this close merged away names its survivor', () => {
    expect(
      verdictOf(writePlan({ actions: [BODY] }), group(noop('gone', 'gone')), mergedIntoKept),
    ).toEqual({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      landed: [],
      skippedFields: [],
      survivor: { table: 'lore', id: LORE_KEPT },
    })
  })

  it('a call with some fields protected lands the free ones and is ok naming the rest', () => {
    const plan = writePlan({
      actions: [BODY],
      lost: [{ field: 'title', reason: USER_EDITED_SINCE_PROSE, kind: 'protected' }],
    })
    expect(verdictOf(plan, group(landed), noMerges)).toEqual({
      result: 'ok',
      landed: ['body'],
      skippedFields: [{ field: 'title', reason: USER_EDITED_SINCE_PROSE }],
    })
  })

  it('a field the handler finds the user wrote is named beside one that landed', () => {
    expect(
      verdictOf(
        writePlan({ actions: [BODY, TITLE] }),
        group(landed, noop(USER_EDITED_SINCE_PROSE)),
        noMerges,
      ),
    ).toEqual({
      result: 'ok',
      landed: ['body'],
      skippedFields: [{ field: 'title', reason: USER_EDITED_SINCE_PROSE }],
    })
  })

  it('a merge with a row a later turn touched is skipped whole', () => {
    const plan = writePlan({
      // 'merge' stands in for whichever path a merge tool names.
      lost: [{ field: 'merge', reason: CLOSE_REASON.laterTurn, kind: 'protected' }],
    })
    expect(verdictOf(plan, null, noMerges)).toEqual({
      result: 'skipped',
      reason: CLOSE_REASON.laterTurn,
      landed: [],
      skippedFields: [],
    })
  })

  it('one protected row in a merge skips it whole', () => {
    const plan = writePlan({
      lost: [{ field: 'merge', reason: USER_EDITED_SINCE_PROSE, kind: 'protected' }],
    })
    expect(verdictOf(plan, null, noMerges)).toEqual({
      result: 'skipped',
      reason: USER_EDITED_SINCE_PROSE,
      landed: [],
      skippedFields: [],
    })
  })

  it('a field refused beside one that lands is ok naming it, and alone is rejected', () => {
    const refused = {
      field: 'keywords',
      reason: 'over the soft cap of 8',
      kind: 'refused',
    } as const
    expect(
      verdictOf(writePlan({ actions: [BODY], lost: [refused] }), group(landed), noMerges),
    ).toEqual({
      result: 'ok',
      landed: ['body'],
      skippedFields: [{ field: 'keywords', reason: refused.reason }],
    })
    expect(verdictOf(writePlan({ lost: [refused] }), null, noMerges)).toEqual({
      result: 'rejected',
      reason: refused.reason,
      landed: [],
      skippedFields: [],
    })
  })
})

describe('verdictOf, failing safe', () => {
  it("rejects a noop it has no rule for, with the handler's reason", () => {
    expect(verdictOf(writePlan({ actions: [BODY] }), group(noop('not-active')), noMerges)).toEqual({
      result: 'rejected',
      reason: 'not-active',
      landed: [],
      skippedFields: [],
    })
  })

  it('rejects a hard not-found with nothing written, as row-gone', () => {
    const notFound: GroupOutcome = {
      status: 'rejected',
      reason: `update target lore ${BRANCH}:${LORE_A} not found`,
      code: TARGET_NOT_FOUND,
    }
    expect(verdictOf(writePlan({ actions: [BODY, TITLE] }), notFound, noMerges)).toEqual({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      landed: [],
      skippedFields: [],
    })
    expect(verdictOf(writePlan({ actions: [BODY] }), notFound, mergedIntoKept)).toMatchObject({
      survivor: { table: 'lore', id: LORE_KEPT },
    })
  })

  it("rejects any other whole-group refusal with the group's reason", () => {
    const codeless: GroupOutcome = {
      status: 'rejected',
      reason: `update target involvement ${BRANCH}:inv_1 not found`,
    }
    expect(verdictOf(writePlan({ actions: [BODY] }), codeless, mergedIntoKept)).toEqual({
      result: 'rejected',
      reason: codeless.reason,
      landed: [],
      skippedFields: [],
    })
  })

  it('a refusal outranks a protection when nothing landed', () => {
    const plan = writePlan({
      actions: [BODY],
      lost: [{ field: 'title', reason: CLOSE_REASON.laterTurn, kind: 'protected' }],
    })
    expect(verdictOf(plan, group(noop('not-active')), noMerges)).toMatchObject({
      result: 'rejected',
      reason: 'not-active',
    })
  })

  it('leaves a restated field out beside one that landed', () => {
    expect(
      verdictOf(
        writePlan({ actions: [BODY, TITLE] }),
        group(landed, noop('title unchanged', 'restated')),
        noMerges,
      ),
    ).toEqual({ result: 'ok', landed: ['body'], skippedFields: [] })
  })

  it("names a landed merge's kept row", () => {
    const plan = writePlan({ actions: [BODY], survivor: { table: 'lore', id: LORE_KEPT } })
    expect(verdictOf(plan, group(landed), noMerges)).toEqual({
      result: 'ok',
      landed: ['body'],
      skippedFields: [],
      survivor: { table: 'lore', id: LORE_KEPT },
    })
  })

  it('is ok with nothing written when no group was needed and nothing was lost', () => {
    expect(verdictOf(writePlan(), null, noMerges)).toEqual({
      result: 'ok',
      landed: [],
      skippedFields: [],
    })
  })

  it('throws when the outcomes do not match the planned actions', () => {
    expect(() => verdictOf(writePlan({ actions: [BODY] }), null, noMerges)).toThrow(/outcomes/)
    expect(() =>
      verdictOf(writePlan({ actions: [BODY] }), group(landed, landed), noMerges),
    ).toThrow(/outcomes/)
  })
})

describe('verdictOf, naming what did not land', () => {
  const BODY_ON_KEPT = loreUpdate({ body: 'Tolls are waived at dawn.' }, ['body'], LORE_KEPT)

  it('throws on a path refused on one row and landed on another', () => {
    expect(() =>
      verdictOf(
        writePlan({ actions: [BODY, BODY_ON_KEPT] }),
        group(landed, noop('not-active')),
        noMerges,
      ),
    ).toThrow('verdictOf: body both landed and was lost')
  })

  it('throws on a capped list path that landed in part', () => {
    const keywords = loreUpdate({ keywords: ['toll', 'bridge'] }, ['keywords'])
    const plan = writePlan({
      actions: [keywords],
      lost: [{ field: 'keywords', reason: 'over the soft cap of 8', kind: 'refused' }],
    })
    expect(() => verdictOf(plan, group(landed), noMerges)).toThrow(
      'verdictOf: keywords both landed and was lost',
    )
  })

  it('lets a path land on one row and be restated on another', () => {
    expect(
      verdictOf(
        writePlan({ actions: [BODY, BODY_ON_KEPT] }),
        group(landed, noop('body unchanged', 'restated')),
        noMerges,
      ),
    ).toEqual({ result: 'ok', landed: ['body'], skippedFields: [] })
  })

  it('skips a call whose one field the handler finds the user wrote', () => {
    expect(
      verdictOf(writePlan({ actions: [BODY] }), group(noop(USER_EDITED_SINCE_PROSE)), noMerges),
    ).toEqual({
      result: 'skipped',
      reason: USER_EDITED_SINCE_PROSE,
      landed: [],
      skippedFields: [],
    })
  })

  it('keeps the first reason for a field lost twice', () => {
    const plan = writePlan({
      actions: [BODY],
      lost: [
        { field: 'title', reason: CLOSE_REASON.laterTurn, kind: 'protected' },
        { field: 'title', reason: 'too long', kind: 'refused' },
      ],
    })
    expect(verdictOf(plan, group(landed), noMerges).skippedFields).toEqual([
      { field: 'title', reason: CLOSE_REASON.laterTurn },
    ])
  })

  it('names a path that landed on two rows once', () => {
    expect(
      verdictOf(writePlan({ actions: [BODY, BODY_ON_KEPT] }), group(landed, landed), noMerges)
        .landed,
    ).toEqual(['body'])
  })

  it("names the survivor of the call's first merged row", () => {
    const plan = writePlan({
      actions: [BODY],
      rows: [
        { table: 'entities', id: CHAR_A, name: 'Tobin' },
        { table: 'lore', id: LORE_A, name: 'The toll law' },
        { table: 'lore', id: LORE_B, name: 'Bridge dues' },
      ],
    })
    const survivors = {
      survivorOf: (table: string, id: string) =>
        id === LORE_A
          ? { table, id: LORE_KEPT }
          : id === LORE_B
            ? { table, id: LORE_OTHER }
            : undefined,
    }
    expect(verdictOf(plan, group(noop('gone', 'gone')), survivors).survivor).toEqual({
      table: 'lore',
      id: LORE_KEPT,
    })
  })

  it('throws on a planned action that names no delta path', () => {
    const unnamed = loreUpdate({ body: 'Tolls double after dark.' }, [])
    expect(() => verdictOf(writePlan({ actions: [unnamed] }), group(landed), noMerges)).toThrow(
      /updateLore/,
    )
    const notFound: GroupOutcome = { status: 'rejected', reason: 'gone', code: TARGET_NOT_FOUND }
    expect(() => verdictOf(writePlan({ actions: [unnamed] }), notFound, noMerges)).toThrow(
      /updateLore/,
    )
  })
})

describe('modelAnswer', () => {
  // lo1 the toll law, lo2 the row a merge kept.
  function shownIds(): CloseIds {
    const ids = new CloseIds()
    ids.show(LORE_A, 'The toll law')
    ids.show(LORE_KEPT, 'Tolls')
    return ids
  }

  it("gives a create's new row as its handle", () => {
    const ids = shownIds()
    ids.show(CHAR_A, 'Tobin')
    expect(
      modelAnswer(
        { result: 'ok', landed: ['name'], skippedFields: [] },
        { createdId: CHAR_A },
        ids,
      ),
    ).toEqual({ result: 'ok', id: 'c1' })
  })

  it('never gives a refused create an id', () => {
    expect(
      modelAnswer(
        { result: 'rejected', reason: 'over the lore cap', landed: [], skippedFields: [] },
        { createdId: CHAR_A },
        shownIds(),
      ),
    ).toEqual({ result: 'rejected', reason: 'over the lore cap' })
  })

  it("swaps a full id in a handler's reason for its handle", () => {
    const answer = modelAnswer(
      {
        result: 'rejected',
        reason: `update target lore ${BRANCH}:${LORE_A} not found`,
        landed: [],
        skippedFields: [],
      },
      {},
      shownIds(),
    )
    expect(answer).toEqual({
      result: 'rejected',
      reason: `update target lore ${BRANCH}:lo1 not found`,
    })
    expect(JSON.stringify(answer)).not.toContain(LORE_A)
  })

  it('says what to do for each stable reason', () => {
    const ids = shownIds()
    expect(
      modelAnswer(
        { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, landed: [], skippedFields: [] },
        {},
        ids,
      ),
    ).toEqual({
      result: 'skipped',
      reason: USER_EDITED_SINCE_PROSE,
      note: expect.stringMatching(/user.*stands/i),
    })
    expect(
      modelAnswer(
        { result: 'skipped', reason: CLOSE_REASON.laterTurn, landed: [], skippedFields: [] },
        {},
        ids,
      ),
    ).toMatchObject({ note: expect.stringMatching(/later turn.*stands/i) })
    expect(
      modelAnswer(
        { result: 'rejected', reason: CLOSE_REASON.rowGone, landed: [], skippedFields: [] },
        {},
        ids,
      ),
    ).toMatchObject({ note: expect.stringMatching(/gone/) })
  })

  it("names a gone row's survivor by its handle", () => {
    expect(
      modelAnswer(
        {
          result: 'rejected',
          reason: CLOSE_REASON.rowGone,
          landed: [],
          skippedFields: [],
          survivor: { table: 'lore', id: LORE_KEPT },
        },
        {},
        shownIds(),
      ),
    ).toEqual({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      note: 'The row was merged into lo2; write to lo2 instead.',
      survivor: 'lo2',
    })
  })

  it("swaps a full id in a field's reason for its handle", () => {
    const answer = modelAnswer(
      {
        result: 'ok',
        landed: ['body'],
        skippedFields: [{ field: 'title', reason: `title clashes with ${LORE_KEPT}` }],
      },
      {},
      shownIds(),
    )
    expect(answer).toEqual({
      result: 'ok',
      notWritten: [{ field: 'title', reason: 'title clashes with lo2' }],
    })
    expect(JSON.stringify(answer)).not.toContain(LORE_KEPT)
  })

  it('names each field that did not land beside one that did', () => {
    expect(
      modelAnswer(
        {
          result: 'ok',
          landed: ['body'],
          skippedFields: [
            { field: 'title', reason: CLOSE_REASON.laterTurn },
            { field: 'keywords', reason: 'over the soft cap' },
          ],
        },
        {},
        shownIds(),
      ),
    ).toEqual({
      result: 'ok',
      notWritten: [
        { field: 'title', reason: CLOSE_REASON.laterTurn, note: expect.any(String) },
        { field: 'keywords', reason: 'over the soft cap' },
      ],
    })
  })
})
