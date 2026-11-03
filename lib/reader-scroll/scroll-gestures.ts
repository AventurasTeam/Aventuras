// lib/reader-scroll/scroll-gestures.ts
const UPWARD_SCROLL_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
const DOWNWARD_SCROLL_KEYS = new Set(['ArrowDown', 'PageDown', 'End'])

/** Whether an unhandled keydown scrolls its scroller up: Shift+Space pages up, Space down. */
export function isUpwardScrollKey(key: { key: string; shiftKey: boolean }): boolean {
  return UPWARD_SCROLL_KEYS.has(key.key) || (key.key === ' ' && key.shiftKey)
}

/** Whether an unhandled keydown scrolls its scroller down. */
export function isDownwardScrollKey(key: { key: string; shiftKey: boolean }): boolean {
  return DOWNWARD_SCROLL_KEYS.has(key.key) || (key.key === ' ' && !key.shiftKey)
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
