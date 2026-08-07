import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { boundedSignal } from './abort'

describe('boundedSignal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // Callers route an expiry to a provider fault and a cancel to the abort arm.
  // Both abort the same call, so this flag is the only thing separating them.
  it('reports expired for a timeout and not for an outer cancel', () => {
    const outer = new AbortController()
    const cancelled = boundedSignal(outer.signal, 1000)
    outer.abort()

    const timedOut = boundedSignal(new AbortController().signal, 1000)
    vi.advanceTimersByTime(1000)

    expect(timedOut.signal.aborted).toBe(true)
    expect(timedOut.expired()).toBe(true)
    expect(cancelled.signal.aborted).toBe(true)
    expect(cancelled.expired()).toBe(false)
  })

  it('relays an already-aborted outer signal without waiting for the timer', () => {
    const outer = new AbortController()
    outer.abort()

    const bounded = boundedSignal(outer.signal, 1000)

    expect(bounded.signal.aborted).toBe(true)
    expect(bounded.expired()).toBe(false)
  })

  // A timer left armed past the call fires while it winds down, flipping a clean
  // cancellation into an apparent provider timeout.
  it('does not expire after an outer cancel clears the timer', () => {
    const outer = new AbortController()
    const bounded = boundedSignal(outer.signal, 1000)

    outer.abort()
    vi.advanceTimersByTime(5000)

    expect(bounded.expired()).toBe(false)
  })

  it('does not expire after dispose', () => {
    const bounded = boundedSignal(undefined, 1000)

    bounded.dispose()
    vi.advanceTimersByTime(5000)

    expect(bounded.expired()).toBe(false)
    expect(bounded.signal.aborted).toBe(false)
  })
})
