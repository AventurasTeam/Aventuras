import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startStallMeter } from './stall-meter'

const T0 = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

// The fake Date is the meter's clock here: setSystemTime moves it and fires no timer, so the
// thread held and no tick ran.
const fakeDateClock = (): number => Date.now()

describe('startStallMeter', () => {
  it('reads a 16 ms gap and the wall time over an idle window', () => {
    const meter = startStallMeter(fakeDateClock)
    vi.advanceTimersByTime(160)
    expect(meter.stop()).toEqual({ wallMs: 160, longestGapMs: 16 })
  })

  it('measures a stall between two ticks', () => {
    const meter = startStallMeter(fakeDateClock)
    vi.advanceTimersByTime(32)
    vi.setSystemTime(T0 + 632)
    vi.advanceTimersByTime(32)
    expect(meter.stop()).toEqual({ wallMs: 664, longestGapMs: 616 })
  })

  it('measures a stall no tick interrupts, from the start to the stop', () => {
    const meter = startStallMeter(fakeDateClock)
    vi.setSystemTime(T0 + 700)
    expect(meter.stop()).toEqual({ wallMs: 700, longestGapMs: 700 })
  })

  it('counts the stretch from the last tick to the stop', () => {
    const meter = startStallMeter(fakeDateClock)
    vi.advanceTimersByTime(32)
    vi.setSystemTime(T0 + 572)
    expect(meter.stop()).toEqual({ wallMs: 572, longestGapMs: 540 })
  })

  it('stops its ticks', () => {
    const meter = startStallMeter(fakeDateClock)
    expect(vi.getTimerCount()).toBe(1)
    meter.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads the clock it is given', () => {
    let clockMs = 50
    const meter = startStallMeter(() => clockMs)
    clockMs = 290
    expect(meter.stop()).toEqual({ wallMs: 240, longestGapMs: 240 })
  })

  it('ignores a system clock moved back mid-window', () => {
    const meter = startStallMeter()
    vi.advanceTimersByTime(160)
    vi.setSystemTime(T0 - 900)
    const { wallMs, longestGapMs } = meter.stop()
    expect(wallMs).toBe(160)
    expect(longestGapMs).toBe(16)
  })
})
