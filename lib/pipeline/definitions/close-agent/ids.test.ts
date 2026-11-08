import { describe, expect, it } from 'vitest'

import { closeIdsOf } from '../close-intermediates'
import { CloseIds, nameCloseProse } from './ids'

const CHAR_A = 'char_11111111-1111-4111-8111-111111111111'
const CHAR_B = 'char_22222222-2222-4222-8222-222222222222'
const LORE_A = 'lore_33333333-3333-4333-8333-333333333333'
const THR_A = 'thr_44444444-4444-4444-8444-444444444444'
const ENTRY_1 = 'entry_55555555-5555-4555-8555-555555555551'
const ENTRY_2 = 'entry_55555555-5555-4555-8555-555555555552'
const ENTRY_3 = 'entry_55555555-5555-4555-8555-555555555553'
const ENTRY_OUT = 'entry_66666666-6666-4666-8666-666666666666'
const HAW_A = 'haw_77777777-7777-4777-8777-777777777777'
const HAW_B = 'haw_88888888-8888-4888-8888-888888888888'
const FULL_ID = /(char|loc|item|fact|lore|thr|hap|chap|entry|haw)_[0-9a-f]{8}-/

describe('CloseIds', () => {
  it('gives each row one handle and keeps its name, lore included', () => {
    const ids = new CloseIds()
    expect(ids.show(CHAR_A, 'Wren')).toBe('c1')
    expect(ids.show(LORE_A, 'The toll law')).toBe('lo1')
    expect(ids.show(CHAR_B, 'Tobin')).toBe('c2')
    expect(ids.show(CHAR_A, 'Wren')).toBe('c1')
    expect(ids.idOf('lo1')).toBe(LORE_A)
    expect(ids.handleOf(CHAR_B)).toBe('c2')
    expect(ids.nameOf('c1')).toBe('Wren')
    expect(ids.nameOf('lo1')).toBe('The toll law')
  })

  it('refuses to show a turn or an awareness row as a row', () => {
    const ids = new CloseIds()
    expect(() => ids.show(ENTRY_1, 'opening')).toThrow(TypeError)
    expect(() => ids.show(HAW_A, 'pin')).toThrow(TypeError)
  })

  it("keeps a row's handle across two tasks and two parts of one run", () => {
    const intermediates: Record<string, unknown> = {}
    const identityPart1 = closeIdsOf(intermediates)
    identityPart1.showTurns([ENTRY_1, ENTRY_2, ENTRY_3])
    expect(identityPart1.show(CHAR_A, 'Wren')).toBe('c1')
    const threadsPart1 = closeIdsOf(intermediates)
    expect(threadsPart1.show(THR_A, 'The sealed letter')).toBe('th1')
    const identityPart2 = closeIdsOf(intermediates)
    expect(identityPart2.show(CHAR_B, 'Tobin')).toBe('c2')
    expect(identityPart2.show(CHAR_A, 'Wren')).toBe('c1')
    expect(identityPart2.idOf('th1')).toBe(THR_A)
    expect(identityPart2.handleOf(ENTRY_2)).toBe('t2')
    expect(identityPart2).toBe(identityPart1)
  })

  it("numbers the chapter's turns by position, once", () => {
    const ids = new CloseIds()
    ids.showTurns([ENTRY_1, ENTRY_2, ENTRY_3])
    expect([ENTRY_1, ENTRY_2, ENTRY_3].map((id) => ids.handleOf(id))).toEqual(['t1', 't2', 't3'])
    expect(ids.idOf('t2')).toBe(ENTRY_2)
    ids.showTurns([ENTRY_1, ENTRY_2, ENTRY_3])
    expect(ids.showTurn(ENTRY_OUT)).toBe('t4')
    expect(() => ids.showTurns([ENTRY_2, ENTRY_1])).toThrow()
  })

  it('gives a turn outside the chapter the next handle, the same each time', () => {
    const ids = new CloseIds()
    ids.showTurns([ENTRY_1, ENTRY_2])
    expect(ids.showTurn(ENTRY_OUT)).toBe('t3')
    expect(ids.showTurn(ENTRY_OUT)).toBe('t3')
    expect(ids.showTurn(ENTRY_2)).toBe('t2')
    expect(ids.idOf('t3')).toBe(ENTRY_OUT)
  })

  it("refuses the chapter's turns once a later turn took t1", () => {
    const ids = new CloseIds()
    ids.showTurn(ENTRY_OUT)
    expect(() => ids.showTurns([ENTRY_1, ENTRY_2])).toThrow()
  })

  it('keeps one aw handle for an awareness row shown twice, and prints it', () => {
    const ids = new CloseIds()
    expect(ids.showAwareness(HAW_A)).toBe('aw1')
    expect(ids.showAwareness(HAW_B)).toBe('aw2')
    expect(ids.showAwareness(HAW_A)).toBe('aw1')
    expect(ids.handleOf(HAW_A)).toBe('aw1')
    expect(ids.idOf('aw2')).toBe(HAW_B)
  })

  it('reads an unknown handle as undefined, never as a turn', () => {
    const ids = new CloseIds()
    ids.showTurns([ENTRY_1, ENTRY_2])
    ids.show(CHAR_A, 'Wren')
    expect(ids.idOf('c9')).toBeUndefined()
    expect(ids.idOf('t9')).toBeUndefined()
    expect(ids.idOf('')).toBeUndefined()
  })

  it('reads a bracketed handle as the bare one it names', () => {
    const ids = new CloseIds()
    ids.show(CHAR_A, 'Wren')
    expect(ids.idOf('[c1]')).toBe(CHAR_A)
    expect(ids.idOf('[c9]')).toBeUndefined()
  })

  it('names row handles only', () => {
    const ids = new CloseIds()
    ids.showTurns([ENTRY_1])
    ids.showAwareness(HAW_A)
    ids.show(CHAR_A, 'Wren')
    ids.show(CHAR_B, '  ')
    expect(ids.nameOf('c1')).toBe('Wren')
    expect(ids.nameOf('t1')).toBeUndefined()
    expect(ids.nameOf('aw1')).toBeUndefined()
    expect(ids.nameOf('c2')).toBeUndefined()
    expect(ids.nameOf('c9')).toBeUndefined()
    expect(ids.nameOfId(CHAR_A)).toBe('Wren')
    expect(ids.nameOfId(LORE_A)).toBeUndefined()
  })

  it('swaps every full id in a text for its handle, giving unseen ones the next', () => {
    const ids = new CloseIds()
    ids.showTurns([ENTRY_1, ENTRY_2])
    ids.show(CHAR_A, 'Wren')
    const reason = `update target entities br_close:${CHAR_A} not found; cited ${ENTRY_2}; pin ${HAW_A}; under ${LORE_A}; from ${ENTRY_OUT}`
    const out = ids.withHandles(reason)
    expect(out).toBe(
      'update target entities br_close:c1 not found; cited t2; pin aw1; under lo1; from t3',
    )
    expect(out).not.toMatch(FULL_ID)
    expect([ids.idOf('aw1'), ids.idOf('lo1'), ids.idOf('t3')]).toEqual([HAW_A, LORE_A, ENTRY_OUT])
  })

  it("swaps a registered turn whose id isn't uuid-shaped, and nothing longer", () => {
    const ids = new CloseIds()
    ids.showTurns(['entry_close_002', 'entry_close_003'])
    expect(ids.withHandles('see entry_close_003, entry_close_0031 and (entry_close_002)')).toBe(
      'see t2, entry_close_0031 and (t1)',
    )
  })
})

describe('nameCloseProse', () => {
  it('names a handle in why and in a text field, and leaves ids, turns and unknown tokens', () => {
    const ids = new CloseIds()
    ids.showTurns([ENTRY_1])
    ids.show(CHAR_A, 'Wren')
    ids.show(LORE_A, 'The toll law')
    const named = nameCloseProse(
      {
        id: 'c1',
        turns: ['t1'],
        why: '[c1] pays the toll in t1',
        body: 'Under lo1, c1 pays; c9 stays',
      },
      ids,
    )
    expect(named).toEqual({
      id: 'c1',
      turns: ['t1'],
      why: 'Wren pays the toll in t1',
      body: 'Under The toll law, Wren pays; c9 stays',
    })
  })
})
