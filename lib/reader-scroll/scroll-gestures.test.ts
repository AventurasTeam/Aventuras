import { describe, expect, it } from 'vitest'

import { isDownwardScrollKey, isScrollbarPress, isUpwardScrollKey } from './scroll-gestures'

const press = (key: string, shiftKey = false, targetTagName = 'BODY') => ({
  key,
  shiftKey,
  targetTagName,
})

describe('isUpwardScrollKey', () => {
  it.each(['ArrowUp', 'PageUp', 'Home'])('takes %s as an upward scroll', (key) => {
    expect(isUpwardScrollKey(press(key))).toBe(true)
  })

  it('takes Shift+Space as a page up', () => {
    expect(isUpwardScrollKey(press(' ', true))).toBe(true)
  })

  it.each(['ArrowDown', 'PageDown', 'End', ' ', 'a'])('leaves %j alone', (key) => {
    expect(isUpwardScrollKey(press(key))).toBe(false)
  })

  it.each(['BUTTON', 'SUMMARY'])('leaves Shift+Space on a %s to its activation', (tagName) => {
    expect(isUpwardScrollKey(press(' ', true, tagName))).toBe(false)
  })

  it.each(['A', 'DIV'])('takes Shift+Space on a %s as a page up', (tagName) => {
    expect(isUpwardScrollKey(press(' ', true, tagName))).toBe(true)
  })

  it('takes an arrow on a button as an upward scroll', () => {
    expect(isUpwardScrollKey(press('ArrowUp', false, 'BUTTON'))).toBe(true)
  })
})

describe('isDownwardScrollKey', () => {
  it.each(['ArrowDown', 'PageDown', 'End'])('takes %s as a downward scroll', (key) => {
    expect(isDownwardScrollKey(press(key))).toBe(true)
  })

  it('takes a plain Space as a page down', () => {
    expect(isDownwardScrollKey(press(' '))).toBe(true)
  })

  it('leaves Shift+Space to the page up', () => {
    expect(isDownwardScrollKey(press(' ', true))).toBe(false)
  })

  it.each(['ArrowUp', 'PageUp', 'Home', 'a'])('leaves %j alone', (key) => {
    expect(isDownwardScrollKey(press(key))).toBe(false)
  })

  it.each(['BUTTON', 'SUMMARY', 'button'])('leaves Space on a %s to its activation', (tagName) => {
    expect(isDownwardScrollKey(press(' ', false, tagName))).toBe(false)
  })

  it.each(['A', 'DIV'])('takes Space on a %s as a page down', (tagName) => {
    expect(isDownwardScrollKey(press(' ', false, tagName))).toBe(true)
  })

  it('takes an arrow on a button as a downward scroll', () => {
    expect(isDownwardScrollKey(press('ArrowDown', false, 'BUTTON'))).toBe(true)
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
