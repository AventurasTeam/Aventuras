/** How many screens of content make a modal's body long enough to offer jumping. */
export const JUMP_SCREENS = 2.5

/** A pixel of slack, so a scroll that stops a fraction short still counts as at the end. */
const SLACK = 1

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * `tallest` is the largest height the scroller has had while open. A phone's keyboard shortens it,
 * and judging length by the shortened height would show and hide the buttons with the keyboard.
 */
export interface JumpInput extends ScrollMetrics {
  tallest: number
}

export interface JumpState {
  /** The body is long enough to show the jump buttons. */
  long: boolean
  atTop: boolean
  atBottom: boolean
}

export function readJumpState({
  scrollTop,
  scrollHeight,
  clientHeight,
  tallest,
}: JumpInput): JumpState {
  const screen = Math.max(tallest, clientHeight)
  return {
    long: screen > 0 && scrollHeight > screen * JUMP_SCREENS,
    atTop: scrollTop <= SLACK,
    atBottom: scrollTop + clientHeight >= scrollHeight - SLACK,
  }
}
