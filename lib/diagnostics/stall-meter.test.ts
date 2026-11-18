import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startStallMeter } from './stall-meter'

const T0 = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

// setSystemTime moves the clock and fires no timer: the thread held, and no tick ran.
describe('startStallMeter', () => {
  it('reads a 16 ms gap and the wall time over an idle window', () => {
    const meter = startStallMeter()
    vi.advanceTimersByTime(160)
    expect(meter.stop()).toEqual({ wallMs: 160, longestGapMs: 16 })
  })

  it('measures a stall between two ticks', () => {
    const meter = startStallMeter()
    vi.advanceTimersByTime(32)
    vi.setSystemTime(T0 + 632)
    vi.advanceTimersByTime(32)
    expect(meter.stop()).toEqual({ wallMs: 664, longestGapMs: 616 })
  })

  it('measures a stall no tick interrupts, from the start to the stop', () => {
    const meter = startStallMeter()
    vi.setSystemTime(T0 + 700)
    expect(meter.stop()).toEqual({ wallMs: 700, longestGapMs: 700 })
  })

  it('counts the stretch from the last tick to the stop', () => {
    const meter = startStallMeter()
    vi.advanceTimersByTime(32)
    vi.setSystemTime(T0 + 572)
    expect(meter.stop()).toEqual({ wallMs: 572, longestGapMs: 540 })
  })

  it('stops its ticks', () => {
    const meter = startStallMeter()
    expect(vi.getTimerCount()).toBe(1)
    meter.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
