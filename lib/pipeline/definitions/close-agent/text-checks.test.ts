import { describe, expect, it } from 'vitest'

import { CloseIds } from './ids'
import { handleInTerm, turnHandleIn, turnInTextReason } from './text-checks'

const WREN = 'char_00000000-0000-4000-8000-000000000001'
const TURNS = ['entry_close_001', 'entry_close_002', 'entry_close_003']

/** t1…t3 and Wren as c1, as a close shows them. */
function shown(): CloseIds {
  const ids = new CloseIds()
  ids.showTurns(TURNS)
  ids.show(WREN, 'Wren')
  return ids
}

describe('turnHandleIn', () => {
  it('finds a turn handle, bare or bracketed, and answers it bare', () => {
    const ids = shown()
    expect(turnHandleIn('As t2 shows, the ferry runs late.', ids)).toBe('t2')
    expect(turnHandleIn('The ferry runs late [t3].', ids)).toBe('t3')
    expect(turnHandleIn("(t1) and t1's", ids)).toBe('t1')
  })

  it('answers the first turn handle, past a row handle before it', () => {
    expect(turnHandleIn('c1 crossed at t3, then t2.', shown())).toBe('t3')
  })

  it('finds a turn outside the chapter that the close showed', () => {
    const ids = shown()
    expect(ids.showTurn('entry_close_009')).toBe('t4')
    expect(turnHandleIn('since t4', ids)).toBe('t4')
  })

  it('skips a row handle, a handle never shown and one inside a word', () => {
    const ids = shown()
    expect(turnHandleIn('c1 waits at the landing.', ids)).toBeUndefined()
    expect(turnHandleIn('As t9 shows.', ids)).toBeUndefined()
    expect(turnHandleIn('at3, t3x, T3 and [t 3]', ids)).toBeUndefined()
    expect(turnHandleIn('', ids)).toBeUndefined()
  })
})

describe('handleInTerm', () => {
  it('finds a row handle or a turn handle in a term, bare', () => {
    const ids = shown()
    expect(handleInTerm('c1', ids)).toBe('c1')
    expect(handleInTerm('the [c1] road', ids)).toBe('c1')
    expect(handleInTerm('t2', ids)).toBe('t2')
  })

  it('passes a term holding no handle the close showed', () => {
    const ids = shown()
    expect(handleInTerm('the ferry', ids)).toBeUndefined()
    expect(handleInTerm('c9', ids)).toBeUndefined()
    expect(handleInTerm('room 101', ids)).toBeUndefined()
    expect(handleInTerm('c3po', ids)).toBeUndefined()
  })
})

describe('turnInTextReason', () => {
  it('names the handle and where a turn goes', () => {
    expect(turnInTextReason('t3')).toBe('t3 is a turn: cite turns in turns, never in the text')
  })
})
