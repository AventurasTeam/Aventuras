// lib/reader-scroll/scroll-gestures.ts
const UPWARD_SCROLL_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
const DOWNWARD_SCROLL_KEYS = new Set(['ArrowDown', 'PageDown', 'End'])
// Space, with or without Shift, activates these and scrolls nothing.
const SPACE_ACTIVATED_TAGS = new Set(['BUTTON', 'SUMMARY'])

/** A keydown as the scroll rules read it; `targetTagName` is the `tagName` of the element it hit. */
export type ScrollKeyPress = { key: string; shiftKey: boolean; targetTagName: string }

function spaceScrolls(press: ScrollKeyPress): boolean {
  return press.key === ' ' && !SPACE_ACTIVATED_TAGS.has(press.targetTagName.toUpperCase())
}

/** Whether an unhandled keydown scrolls its scroller up: Shift+Space pages up, Space down. */
export function isUpwardScrollKey(press: ScrollKeyPress): boolean {
  return UPWARD_SCROLL_KEYS.has(press.key) || (spaceScrolls(press) && press.shiftKey)
}

/** Whether an unhandled keydown scrolls its scroller down. */
export function isDownwardScrollKey(press: ScrollKeyPress): boolean {
  return DOWNWARD_SCROLL_KEYS.has(press.key) || (spaceScrolls(press) && !press.shiftKey)
}

/**
 * Whether a press landed on the scroller's own scrollbar, not its content: on the scroller itself,
 * past its client width, while it overflows. An overlay scrollbar takes no width, so it never reads
 * as one, and a stable gutter on a scroller with nothing to scroll holds no scrollbar.
 */
export function isScrollbarPress(press: {
  onScroller: boolean
  offsetX: number
  clientWidth: number
  overflows: boolean
}): boolean {
  return press.onScroller && press.overflows && press.offsetX >= press.clientWidth
}
