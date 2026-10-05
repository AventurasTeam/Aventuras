import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { abortCauseOf, boundedSignal } from './abort'

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

// React Native's setUpXHR installs abort-controller@3, whose abort() drops its argument,
// so on device the cause cannot ride `signal.reason`.
class ReasonDroppingAbortController extends AbortController {
  override abort(): void {
    super.abort()
  }
}

describe('abortCauseOf under an AbortController that drops the reason', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('AbortController', ReasonDroppingAbortController)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reads an expiry as a timeout', () => {
    const bounded = boundedSignal(new AbortController().signal, 1000)
    vi.advanceTimersByTime(1000)

    expect(bounded.signal.aborted).toBe(true)
    expect(abortCauseOf(bounded.signal)).toBe('timeout')
  })

  it('reads an outer cancel as a stop', () => {
    const outer = new AbortController()
    const bounded = boundedSignal(outer.signal, 1000)
    outer.abort()

    expect(bounded.signal.aborted).toBe(true)
    expect(abortCauseOf(bounded.signal)).toBe('stop')
  })

  it('carries an outer expiry through the relay', () => {
    const outer = boundedSignal(undefined, 1000)
    const inner = boundedSignal(outer.signal, 5000)
    vi.advanceTimersByTime(1000)

    expect(inner.signal.aborted).toBe(true)
    expect(inner.expired()).toBe(false)
    expect(abortCauseOf(inner.signal)).toBe('timeout')
  })
})
