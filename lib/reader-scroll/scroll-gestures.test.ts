import { describe, expect, it } from 'vitest'

import { isDownwardScrollKey, isScrollbarPress, isUpwardScrollKey } from './scroll-gestures'

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

describe('isDownwardScrollKey', () => {
  it.each(['ArrowDown', 'PageDown', 'End'])('takes %s as a downward scroll', (key) => {
    expect(isDownwardScrollKey({ key, shiftKey: false })).toBe(true)
  })

  it('takes a plain Space as a page down', () => {
    expect(isDownwardScrollKey({ key: ' ', shiftKey: false })).toBe(true)
  })

  it('leaves Shift+Space to the page up', () => {
    expect(isDownwardScrollKey({ key: ' ', shiftKey: true })).toBe(false)
  })

  it.each(['ArrowUp', 'PageUp', 'Home', 'a'])('leaves %j alone', (key) => {
    expect(isDownwardScrollKey({ key, shiftKey: false })).toBe(false)
  })
})

describe('isScrollbarPress', () => {
  it('takes a press past the client width on the scroller as its scrollbar', () => {
    expect(
      isScrollbarPress({ onScroller: true, offsetX: 805, clientWidth: 800, overflows: true }),
    ).toBe(true)
    expect(
      isScrollbarPress({ onScroller: true, offsetX: 800, clientWidth: 800, overflows: true }),
    ).toBe(true)
  })

  it('leaves a press inside the content alone', () => {
    expect(
      isScrollbarPress({ onScroller: true, offsetX: 799, clientWidth: 800, overflows: true }),
    ).toBe(false)
  })

  // A reserved gutter (scrollbar-gutter: stable) sits past the client width, holding no scrollbar.
  it('leaves a press in the gutter of a scroller that does not overflow alone', () => {
    expect(
      isScrollbarPress({ onScroller: true, offsetX: 805, clientWidth: 800, overflows: false }),
    ).toBe(false)
  })

  // A row's own offsetX is measured from the row, so only the scroller's own presses count.
  it('leaves a press on a row alone, wherever it lands', () => {
    expect(
      isScrollbarPress({ onScroller: false, offsetX: 805, clientWidth: 800, overflows: true }),
    ).toBe(false)
  })
})
