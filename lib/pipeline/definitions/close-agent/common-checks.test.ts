import { describe, expect, it } from 'vitest'

import type { GuardRow } from '@/lib/actions/types'
import { generateId } from '@/lib/ids'

import { commonChecks, createReadSet } from './common-checks'
import { CloseIds } from './ids'

const ENTRY_1 = 'entry_11111111-1111-4111-8111-111111111111'
const ENTRY_2 = 'entry_22222222-2222-4222-8222-222222222222'
const ENTRY_3 = 'entry_33333333-3333-4333-8333-333333333333'
const ENTRY_LATER = 'entry_44444444-4444-4444-8444-444444444444'
const CHAR_A = 'char_55555555-5555-4555-8555-555555555555'
const LORE_A = 'lore_66666666-6666-4666-8666-666666666666'

const WREN: GuardRow = { table: 'entities', id: CHAR_A }
const TOLL_LAW: GuardRow = { table: 'lore', id: LORE_A }

// The chapter is t1…t3, all shown to the task; t4 is a turn past it. Wren (c1) is seeded as read,
// the toll law (lo1) isn't.
function checkContext(taskEntryIds: readonly string[] = [ENTRY_1, ENTRY_2, ENTRY_3]) {
  const ids = new CloseIds()
  ids.showTurns([ENTRY_1, ENTRY_2, ENTRY_3])
  ids.showTurn(ENTRY_LATER)
  ids.show(CHAR_A, 'Wren')
  ids.show(LORE_A, 'The toll law')
  const readSet = createReadSet()
  readSet.add([WREN])
  return { ids, taskEntryIds, readSet }
}

describe('commonChecks', () => {
  it('passes a write on a seeded row, giving its turns and the latest by position', () => {
    expect(
      commonChecks({ turns: ['t3', 't1'], why: 'Wren pays the toll.' }, [WREN], checkContext()),
    ).toEqual({ ok: true, turns: [ENTRY_1, ENTRY_3], proseEntryId: ENTRY_3 })
  })

  it('takes the prose entry by position, not by citation order', () => {
    expect(commonChecks({ turns: ['t2', 't1', 't2'], why: 'w' }, [WREN], checkContext())).toEqual({
      ok: true,
      turns: [ENTRY_1, ENTRY_2],
      proseEntryId: ENTRY_2,
    })
  })

  it.each<{ name: string; args: { turns: unknown; why: unknown }; reason: RegExp }>([
    { name: 'cites nothing', args: { turns: [], why: 'w' }, reason: /^turns is empty/ },
    {
      name: 'has no turns at all',
      args: { turns: undefined, why: 'w' },
      reason: /^turns is empty/,
    },
    {
      name: 'cites an unknown turn handle',
      args: { turns: ['t1', 't9'], why: 'w' },
      reason: /^t9 is not a turn/,
    },
    {
      name: 'cites a row handle as a turn',
      args: { turns: ['c1'], why: 'w' },
      reason: /^c1 is not a turn/,
    },
    {
      name: 'cites a turn outside the chapter',
      args: { turns: ['t4'], why: 'w' },
      reason: /^t4 is not one of the turns this task was shown/,
    },
    { name: 'gives a blank why', args: { turns: ['t1'], why: '   ' }, reason: /^why is empty/ },
    { name: 'gives no why', args: { turns: ['t1'], why: undefined }, reason: /^why is empty/ },
  ])('rejects a write that $name', ({ args, reason }) => {
    expect(commonChecks(args, [WREN], checkContext())).toEqual({
      ok: false,
      reason: expect.stringMatching(reason),
    })
  })

  // A part shows its own turns; another part's are as unseen as a turn past the chapter.
  it("refuses a chapter turn this task wasn't shown, as another part's, naming what to cite", () => {
    const partTwo = checkContext([ENTRY_2, ENTRY_3])
    expect(commonChecks({ turns: ['t2', 't1'], why: 'w' }, [WREN], partTwo)).toEqual({
      ok: false,
      reason: 't1 is not one of the turns this task was shown: cite only those turns',
    })
    expect(commonChecks({ turns: ['t3', 't2'], why: 'w' }, [WREN], partTwo)).toEqual({
      ok: true,
      turns: [ENTRY_2, ENTRY_3],
      proseEntryId: ENTRY_3,
    })
  })

  // In a later part, t1 and t2 are the very turns refused: no turns refusal offers them.
  it('points a turns refusal at the turns this task was shown, with no handle as an example', () => {
    const partTwo = checkContext([ENTRY_2, ENTRY_3])
    const reasonOf = (turns: unknown) => {
      const result = commonChecks({ turns, why: 'w' }, [WREN], partTwo)
      return result.ok ? undefined : result.reason
    }
    expect(reasonOf([])).toBe(
      'turns is empty: cite the turns this task was shown, by their handles',
    )
    expect(reasonOf(['c1'])).toBe(
      'c1 is not a turn: cite the turns this task was shown, by their handles',
    )
    expect(reasonOf([ENTRY_1])).toBe(
      'turns takes the short handles of the turns this task was shown, not a full id',
    )
  })

  it('rejects a write on a row the task has not read, naming it and read_row', () => {
    expect(commonChecks({ turns: ['t1'], why: 'w' }, [WREN, TOLL_LAW], checkContext())).toEqual({
      ok: false,
      reason: expect.stringMatching(/^lo1 .*read_row/),
    })
  })

  it('names the first unread row, wherever it sits among the named rows', () => {
    const OTHER_LORE: GuardRow = { table: 'lore', id: 'lore_77777777-7777-4777-8777-777777777777' }
    const refusal = (named: GuardRow[]) => {
      const ctx = checkContext()
      ctx.ids.show(OTHER_LORE.id, 'The ferry rule')
      return commonChecks({ turns: ['t1'], why: 'w' }, named, ctx)
    }
    expect(refusal([TOLL_LAW, WREN])).toEqual({
      ok: false,
      reason: expect.stringMatching(/^lo1 /),
    })
    expect(refusal([WREN, TOLL_LAW, OTHER_LORE])).toEqual({
      ok: false,
      reason: expect.stringMatching(/^lo1 /),
    })
    expect(refusal([OTHER_LORE, TOLL_LAW])).toEqual({
      ok: false,
      reason: expect.stringMatching(/^lo2 /),
    })
  })

  it.each([
    { name: 'a made-up entry id', cited: generateId('entry') },
    { name: 'a made-up row id', cited: generateId('char') },
    { name: 'a real chapter entry id', cited: ENTRY_2 },
    { name: 'a bracketed full id', cited: `[${generateId('entry')}]` },
  ])('refuses $name as a turn without echoing it or minting a handle', ({ cited }) => {
    const ctx = checkContext()
    const result = commonChecks({ turns: [cited], why: 'w' }, [WREN], ctx)
    expect(result).toEqual({
      ok: false,
      reason: 'turns takes the short handles of the turns this task was shown, not a full id',
    })
    const reason = result.ok ? '' : result.reason
    expect(reason).not.toMatch(/_[0-9a-f]{8}-/)
    ctx.ids.withHandles(reason)
    expect(ctx.ids.idOf('t5')).toBeUndefined()
    expect(ctx.ids.idOf('c2')).toBeUndefined()
  })

  it('checks turns, then why, then the read gate', () => {
    const ctx = checkContext()
    expect(commonChecks({ turns: [], why: '' }, [TOLL_LAW], ctx)).toEqual({
      ok: false,
      reason: expect.stringMatching(/^turns/),
    })
    expect(commonChecks({ turns: ['t1'], why: '' }, [TOLL_LAW], ctx)).toEqual({
      ok: false,
      reason: expect.stringMatching(/^why/),
    })
  })
})

describe('createReadSet', () => {
  it('holds a row by table and id, and only in its own set', () => {
    const first = createReadSet()
    first.add([WREN])
    expect(first.has(WREN)).toBe(true)
    expect(first.has({ table: 'lore', id: CHAR_A })).toBe(false)
    expect(createReadSet().has(WREN)).toBe(false)
  })
})
