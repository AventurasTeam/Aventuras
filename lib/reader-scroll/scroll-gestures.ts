// lib/reader-scroll/scroll-gestures.ts
const UPWARD_SCROLL_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

/** Whether an unhandled keydown scrolls its scroller up: Shift+Space pages up, Space down. */
export function isUpwardScrollKey(key: { key: string; shiftKey: boolean }): boolean {
  return UPWARD_SCROLL_KEYS.has(key.key) || (key.key === ' ' && key.shiftKey)
}

/**
 * Whether a press landed on the scroller's own scrollbar, not its content: on the scroller itself,
 * past its client width. An overlay scrollbar takes no width, so it never reads as one.
 */
export function isScrollbarPress(press: {
  onScroller: boolean
  offsetX: number
  clientWidth: number
}): boolean {
  return press.onScroller && press.offsetX >= press.clientWidth
}
