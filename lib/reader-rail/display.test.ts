import { describe, expect, it } from 'vitest'

import type { RailPeek } from './categories'
import {
  initialRailDisplay,
  isRailCollapsed,
  reduceRailDisplay,
  type RailDisplayEvent,
  type RailDisplayState,
} from './display'

const PEEK: RailPeek = { category: 'thread', id: 'thr_1' }

const resize = (width: number): RailDisplayEvent => ({ type: 'resize', width })
const setCollapsed = (collapsed: boolean): RailDisplayEvent => ({ type: 'setCollapsed', collapsed })
const persisted = (collapsed: boolean): RailDisplayEvent => ({ type: 'persisted', collapsed })
const openPeek = (storedCollapsed: boolean): RailDisplayEvent => ({
  type: 'openPeek',
  peek: PEEK,
  storedCollapsed,
})

function run(state: RailDisplayState, ...events: RailDisplayEvent[]): RailDisplayState {
  return events.reduce(reduceRailDisplay, state)
}

// The display against a stored preference of open, unless a test passes another.
function shown(state: RailDisplayState, storedCollapsed = false): 'collapsed' | 'open' {
  return isRailCollapsed(state, storedCollapsed) ? 'collapsed' : 'open'
}

describe('initialRailDisplay', () => {
  it('starts forced-collapsed below 900 px and unforced from 900 px up', () => {
    expect(shown(initialRailDisplay(850))).toBe('collapsed')
    expect(shown(initialRailDisplay(899))).toBe('collapsed')
    expect(shown(initialRailDisplay(900))).toBe('open')
    expect(initialRailDisplay(1200)).toEqual({
      lastWidth: 1200,
      forced: false,
      pendingCollapsed: null,
      peek: null,
    })
  })

  it('shows the stored preference when nothing forces it', () => {
    expect(shown(initialRailDisplay(1200), true)).toBe('collapsed')
  })
})

describe('reduceRailDisplay — viewport', () => {
  it('collapses on a cross below 900 px without touching the preference', () => {
    const state = run(initialRailDisplay(1200), resize(850))
    expect(shown(state)).toBe('collapsed')
    expect(state.pendingCollapsed).toBeNull()
  })

  it('stays collapsed inside the band', () => {
    expect(shown(run(initialRailDisplay(1200), resize(850), resize(950)))).toBe('collapsed')
  })

  it('restores the stored preference on a cross above 980 px', () => {
    const state = run(initialRailDisplay(1200), resize(850), resize(950), resize(1000))
    expect(shown(state, false)).toBe('open')
    expect(shown(state, true)).toBe('collapsed')
  })

  it('counts 900 and 980 as inside the band', () => {
    expect(shown(run(initialRailDisplay(1200), resize(900)))).toBe('open')
    expect(shown(run(initialRailDisplay(1200), resize(900), resize(899)))).toBe('collapsed')
    const atTop = run(initialRailDisplay(1200), resize(850), resize(980))
    expect(shown(atTop)).toBe('collapsed')
    expect(shown(run(atTop, resize(981)))).toBe('open')
  })

  it('crosses the whole band in one resize', () => {
    expect(shown(run(initialRailDisplay(1200), resize(600)))).toBe('collapsed')
    expect(shown(run(initialRailDisplay(600), resize(1300)))).toBe('open')
  })

  it('records every width', () => {
    expect(run(initialRailDisplay(1200), resize(950), resize(1100)).lastWidth).toBe(1100)
  })
})

describe('reduceRailDisplay — manual preference', () => {
  it('shows a toggle ahead of the stored value', () => {
    expect(shown(run(initialRailDisplay(1200), setCollapsed(true)), false)).toBe('collapsed')
    expect(shown(run(initialRailDisplay(1200), setCollapsed(false)), true)).toBe('open')
  })

  it('keeps a manual expand below 900 px through further resizes under 900', () => {
    const expanded = run(initialRailDisplay(1200), resize(850), setCollapsed(false))
    expect(shown(expanded)).toBe('open')
    expect(shown(run(expanded, resize(870), resize(890)))).toBe('open')
  })

  it('re-collapses a manual expand on the next downward cross', () => {
    const expanded = run(initialRailDisplay(1200), resize(850), setCollapsed(false))
    expect(shown(run(expanded, resize(950), resize(880)))).toBe('collapsed')
  })

  it('keeps a manual expand in a window that opened below 900 px', () => {
    const expanded = run(initialRailDisplay(800), setCollapsed(false))
    expect(shown(run(expanded, resize(850)))).toBe('open')
  })
})

describe('reduceRailDisplay — persisted', () => {
  it('drops the pending value once its write lands', () => {
    const state = run(initialRailDisplay(1200), setCollapsed(true), persisted(true))
    expect(state.pendingCollapsed).toBeNull()
    expect(shown(state, true)).toBe('collapsed')
  })

  it('keeps a newer toggle pending when the older write lands', () => {
    const state = run(
      initialRailDisplay(1200),
      setCollapsed(true),
      setCollapsed(false),
      persisted(true),
    )
    expect(state.pendingCollapsed).toBe(false)
    // The first write stored `true`; the second toggle still shows.
    expect(shown(state, true)).toBe('open')
    expect(run(state, persisted(false)).pendingCollapsed).toBeNull()
  })

  it('returns the same state when nothing is pending', () => {
    const state = initialRailDisplay(1200)
    expect(reduceRailDisplay(state, persisted(true))).toBe(state)
  })
})

describe('reduceRailDisplay — peek', () => {
  it('opens a peek while the rail shows open', () => {
    expect(run(initialRailDisplay(1200), openPeek(false)).peek).toEqual(PEEK)
  })

  it('ignores a peek while the rail shows collapsed, for any reason', () => {
    const forced = run(initialRailDisplay(1200), resize(850))
    expect(reduceRailDisplay(forced, openPeek(false))).toBe(forced)
    const stored = initialRailDisplay(1200)
    expect(reduceRailDisplay(stored, openPeek(true))).toBe(stored)
    const pending = run(initialRailDisplay(1200), setCollapsed(true))
    expect(reduceRailDisplay(pending, openPeek(false))).toBe(pending)
  })

  it('closes an open peek on a viewport collapse', () => {
    expect(run(initialRailDisplay(1200), openPeek(false), resize(850)).peek).toBeNull()
  })

  it('closes an open peek on a manual collapse', () => {
    expect(run(initialRailDisplay(1200), openPeek(false), setCollapsed(true)).peek).toBeNull()
  })

  it('closes the peek on closePeek', () => {
    expect(run(initialRailDisplay(1200), openPeek(false), { type: 'closePeek' }).peek).toBeNull()
  })
})
