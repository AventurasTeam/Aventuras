import { describe, it, expect } from 'vitest'
import { resolveStickiness } from './stickiness'
import type { ActivationTracker } from './EntryRetrievalService'

const trackerAt = (lastActivation: number | null): ActivationTracker => ({
  getLastActivation: () => lastActivation,
  recordActivation: () => {},
  currentPosition: 0,
})

describe('resolveStickiness', () => {
  it('is null for something never activated', () => {
    expect(resolveStickiness(trackerAt(null), 'x', 10, 3)).toBeNull()
  })

  it('is null once the window has passed', () => {
    // Activated at 5, duration 3: positions 5..8 are inside, 9 is not.
    expect(resolveStickiness(trackerAt(5), 'x', 8, 3)).not.toBeNull()
    expect(resolveStickiness(trackerAt(5), 'x', 9, 3)).toBeNull()
  })

  it('scores highest on the position it was activated', () => {
    expect(resolveStickiness(trackerAt(5), 'x', 5, 3)?.priority).toBe(80)
  })

  it('fades as the window runs out, without falling out of the band', () => {
    const at = (position: number) => resolveStickiness(trackerAt(5), 'x', position, 3)!.priority

    expect(at(5)).toBeGreaterThan(at(6))
    expect(at(6)).toBeGreaterThan(at(7))
    expect(at(7)).toBeGreaterThan(at(8))
    // Still above the floor on its last position: about to expire is not the same as gone.
    expect(at(8)).toBeGreaterThan(60)
    expect(at(8)).toBeLessThan(80)
  })

  it('reports how much of the window is left', () => {
    expect(resolveStickiness(trackerAt(5), 'x', 5, 3)?.positionsLeft).toBe(3)
    expect(resolveStickiness(trackerAt(5), 'x', 8, 3)?.positionsLeft).toBe(0)
  })

  it('keeps a longer duration alive longer, at the same freshness', () => {
    // The band is shared; only the durations differ per service, so a longer-lived type
    // must not score differently on the position it was activated.
    expect(resolveStickiness(trackerAt(5), 'x', 5, 5)?.priority).toBe(80)
    expect(resolveStickiness(trackerAt(5), 'x', 9, 5)).not.toBeNull()
    expect(resolveStickiness(trackerAt(5), 'x', 9, 3)).toBeNull()
  })
})
