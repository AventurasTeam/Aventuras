import { describe, expect, it } from 'vitest'

import type { RailPeek } from './categories'
import {
  RAIL_SHEET_OPENED,
  reduceRailSheet,
  type RailSheetEvent,
  type RailSheetState,
} from './sheet'

const PEEK: RailPeek = { category: 'character', id: 'char_1' }

const CATEGORIES: RailSheetState = { content: 'categories', size: 'medium' }
const LIST: RailSheetState = { content: 'list', size: 'medium' }
const PEEKING: RailSheetState = { content: 'peek', size: 'tall', peek: PEEK }
const STATES = { categories: CATEGORIES, list: LIST, peek: PEEKING } as const

const EVENTS = {
  up: { type: 'up' },
  pickCategory: { type: 'pickCategory' },
  openPeek: { type: 'openPeek', peek: PEEK },
  back: { type: 'back' },
} as const satisfies Record<RailSheetEvent['type'], RailSheetEvent>

describe('reduceRailSheet', () => {
  it('opens on the list at the medium detent', () => {
    expect(RAIL_SHEET_OPENED).toEqual({ content: 'list', size: 'medium' })
  })

  it('goes up from the list to the categories, staying medium', () => {
    expect(reduceRailSheet(LIST, EVENTS.up)).toEqual({ content: 'categories', size: 'medium' })
  })

  it('comes back down to the list when a category is picked', () => {
    expect(reduceRailSheet(CATEGORIES, EVENTS.pickCategory)).toEqual({
      content: 'list',
      size: 'medium',
    })
  })

  it('swaps the list for the peek at the tall detent', () => {
    expect(reduceRailSheet(LIST, EVENTS.openPeek)).toEqual({
      content: 'peek',
      size: 'tall',
      peek: PEEK,
    })
  })

  it('goes back from the peek to the list at the medium detent', () => {
    expect(reduceRailSheet(PEEKING, EVENTS.back)).toEqual({ content: 'list', size: 'medium' })
  })

  it.each([
    ['categories', 'up'],
    ['categories', 'openPeek'],
    ['categories', 'back'],
    ['list', 'pickCategory'],
    ['list', 'back'],
    ['peek', 'up'],
    ['peek', 'pickCategory'],
    ['peek', 'openPeek'],
  ] as const)('leaves %s unchanged on %s', (content, type) => {
    const state = STATES[content]
    expect(reduceRailSheet(state, EVENTS[type])).toBe(state)
  })

  it('walks list → categories → list → peek → list', () => {
    const levels: string[] = []
    let state = RAIL_SHEET_OPENED
    for (const event of [EVENTS.up, EVENTS.pickCategory, EVENTS.openPeek, EVENTS.back]) {
      state = reduceRailSheet(state, event)
      levels.push(`${state.content}/${state.size}`)
    }
    expect(levels).toEqual(['categories/medium', 'list/medium', 'peek/tall', 'list/medium'])
  })
})
