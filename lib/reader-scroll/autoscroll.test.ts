// lib/reader-scroll/autoscroll.test.ts
import { describe, expect, it } from 'vitest'

import { createAutoscrollMachine } from './autoscroll'

const AT_BOTTOM_TOLERANCE_PX = 80

describe('createAutoscrollMachine', () => {
  it('engages when a stream starts at-bottom', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    expect(m.state).toBe('engaged')
  })

  it('stays disengaged when a stream starts away from bottom', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 400 })
    expect(m.state).toBe('disengaged')
  })

  it('treats the 80px tolerance as at-bottom', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: AT_BOTTOM_TOLERANCE_PX })
    expect(m.state).toBe('engaged')
  })

  it('disengages on user-initiated upscroll mid-stream', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    m.userScrolled({ distanceFromBottomPx: 300 })
    expect(m.state).toBe('disengaged')
  })

  it('re-engages when the user scrolls back within tolerance mid-stream', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    m.userScrolled({ distanceFromBottomPx: 300 })
    m.userScrolled({ distanceFromBottomPx: 50 })
    expect(m.state).toBe('engaged')
  })

  it('resets fresh on the next stream regardless of prior state', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    m.userScrolled({ distanceFromBottomPx: 300 })
    m.streamEnded()
    m.streamStarted({ distanceFromBottomPx: 500 })
    expect(m.state).toBe('disengaged')
  })

  it('hard-disengages on an explicit user gesture and holds through the gesture echo', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    m.autoscrollApplied({ distanceFromBottomPx: 0 })
    m.userInterrupted()
    expect(m.state).toBe('disengaged')
    // The wheel's own scroll event lands inside the tolerance (the per-chunk
    // pin loop kept the user at-bottom) — it must NOT positionally re-engage.
    m.userScrolled({ distanceFromBottomPx: 30 })
    expect(m.state).toBe('disengaged')
  })

  it('re-arms positional re-engage once the user has left the at-bottom band', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    m.userInterrupted()
    m.userScrolled({ distanceFromBottomPx: 30 }) // gesture echo — latched, ignored
    m.userScrolled({ distanceFromBottomPx: 300 }) // genuinely away — unlatches
    m.userScrolled({ distanceFromBottomPx: 50 }) // back to the live edge
    expect(m.state).toBe('engaged')
  })

  it('a new stream clears the interrupt latch', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    m.userInterrupted()
    m.streamEnded()
    m.streamStarted({ distanceFromBottomPx: 0 })
    expect(m.state).toBe('engaged')
  })

  it('does not disengage on programmatic scroll (autoscroll writing scrollTop itself)', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 0 })
    m.autoscrollApplied({ distanceFromBottomPx: 0 })
    expect(m.state).toBe('engaged')
  })

  it('clears the programmatic marker after any user scroll, so a later coincidental match is not swallowed', () => {
    const m = createAutoscrollMachine()
    m.streamStarted({ distanceFromBottomPx: 300 })
    m.autoscrollApplied({ distanceFromBottomPx: 50 })
    m.userScrolled({ distanceFromBottomPx: 300 }) // genuine scroll, doesn't match the marker
    m.userScrolled({ distanceFromBottomPx: 50 }) // genuine scroll back to 50 — must be processed as real input, not swallowed as a stale echo
    expect(m.state).toBe('engaged')
  })
})
