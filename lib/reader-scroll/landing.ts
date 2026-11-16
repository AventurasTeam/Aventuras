// lib/reader-scroll/landing.ts
// A trackpad's momentum arrives as wheel events about a frame apart; a longer gap is a new gesture.
export const WHEEL_CHAIN_GAP_MS = 100
// Trackpad momentum runs 1-3 s; a chain held longer is the user's own scrolling through the press.
const WHEEL_HOLD_MAX_MS = 3_000
const LANDING_SETTLED_FRAMES = 10
const LANDING_MAX_FRAMES = 600

/** What one frame of a jump's landing reads before it writes. */
export type LandingFrame = {
  now: number
  /** Wheel events are still arriving: a trackpad's momentum the landing holds off. */
  wheelChainLive: boolean
  rowConnected: boolean
  /** The scroller has a box: a reader under another screen isn't laid out. */
  laidOut: boolean
  fingerDown: boolean
  scrollTop: number
}

export type LandingStep =
  | { kind: 'stop' }
  | {
      kind: 'frame'
      /** A hidden scroller takes no wheel, so the chain's momentum can't move it. */
      overflowY: 'hidden' | ''
      /** Write the row into place this frame. */
      land: boolean
      /** The first landed frame: start the row's tint. */
      highlight: boolean
    }

export type LandingSettle = {
  /** Hide overflow for one frame to drop a fling. */
  haltOverflow: boolean
  done: boolean
}

/**
 * A jump's per-frame landing rules (reader-composer.md → Where a jump lands). Call `plan` before
 * the write and `settle` on the read-back position: the browser clamps a write at either end.
 */
export type LandingMachine = {
  plan(frame: LandingFrame): LandingStep
  settle(reading: { after: number; scrollHeight: number }): LandingSettle
}

const STOP = { kind: 'stop' } as const

export function createLandingMachine(): LandingMachine {
  let highlighted = false
  let stableFrames = 0
  let totalFrames = 0
  let lastHeight = -1
  let lastScrollTop: number | null = null
  let movingFrames = 0
  let halting = false
  let halted = false
  let wheelHoldStartedAt: number | null = null
  let current = { wheelChainLive: false, writable: false, land: false, before: 0 }

  return {
    plan(frame) {
      if (frame.wheelChainLive) wheelHoldStartedAt ??= frame.now
      // The row has long since landed; staying on, the wheel hold would freeze the user's scroll.
      if (
        frame.wheelChainLive &&
        frame.now - (wheelHoldStartedAt ?? frame.now) >= WHEEL_HOLD_MAX_MS
      )
        return STOP
      // A reload can drop the row, and a detached row's rect would read as a huge delta.
      if (!frame.rowConnected) return STOP
      // Nothing lands in a reader not laid out, under a finger, or into a fling, which a write
      // doesn't stop: the position must rest a frame or the fling be halted.
      const writable = frame.laidOut && !frame.fingerDown
      const atRest = lastScrollTop != null && Math.abs(frame.scrollTop - lastScrollTop) < 1
      // The reader's own writes move the scroll on one frame; a fling moves it on every frame.
      movingFrames = lastScrollTop != null && !atRest ? movingFrames + 1 : 0
      const land = writable && atRest && !halting
      const highlight = land && !highlighted
      if (highlight) highlighted = true
      current = { wheelChainLive: frame.wheelChainLive, writable, land, before: frame.scrollTop }
      return { kind: 'frame', overflowY: frame.wheelChainLive ? 'hidden' : '', land, highlight }
    },
    settle({ after, scrollHeight }) {
      lastScrollTop = current.writable ? after : null
      // One halt: should a fling outlive it, the loop waits for rest rather than fight it.
      halting = current.writable && !halted && movingFrames >= 2
      if (halting) halted = true
      // A frame that didn't land never settles, or the loop would end without having landed. Nor
      // has one the loop had to correct (a fling's sub-pixel tail reads as rest), or one inside a
      // chain, whose next wheel would scroll the reader once the loop let go.
      const settled =
        current.land &&
        !current.wheelChainLive &&
        Math.abs(after - current.before) < 1 &&
        scrollHeight === lastHeight
      stableFrames = settled ? stableFrames + 1 : 0
      lastHeight = scrollHeight
      totalFrames += 1
      return {
        haltOverflow: halting,
        done: stableFrames >= LANDING_SETTLED_FRAMES || totalFrames >= LANDING_MAX_FRAMES,
      }
    },
  }
}
