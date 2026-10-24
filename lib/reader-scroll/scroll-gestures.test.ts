import { describe, expect, it } from 'vitest'

import { isScrollbarPress, isUpwardScrollKey } from './scroll-gestures'

describe('isUpwardScrollKey', () => {
  it.each(['ArrowUp', 'PageUp', 'Home'])('takes %s as an upward scroll', (key) => {
    expect(isUpwardScrollKey({ key, shiftKey: false })).toBe(true)
  })

  it('takes Shift+Space as a page up', () => {
    expect(isUpwardScrollKey({ key: ' ', shiftKey: true })).toBe(true)
  })

  it.each(['ArrowDown', 'PageDown', 'End', ' ', 'a'])('leaves %j alone', (key) => {
    expect(isUpwardScrollKey({ key, shiftKey: false })).toBe(false)
  })
})

describe('isScrollbarPress', () => {
  it('takes a press past the client width on the scroller as its scrollbar', () => {
    expect(isScrollbarPress({ onScroller: true, offsetX: 805, clientWidth: 800 })).toBe(true)
    expect(isScrollbarPress({ onScroller: true, offsetX: 800, clientWidth: 800 })).toBe(true)
  })

  it('leaves a press inside the content alone', () => {
    expect(isScrollbarPress({ onScroller: true, offsetX: 799, clientWidth: 800 })).toBe(false)
  })

  // A row's own offsetX is measured from the row, so only the scroller's own presses count.
  it('leaves a press on a row alone, wherever it lands', () => {
    expect(isScrollbarPress({ onScroller: false, offsetX: 805, clientWidth: 800 })).toBe(false)
  })
})
