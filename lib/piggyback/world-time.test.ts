import { describe, expect, it } from 'vitest'

import { MAX_WORLD_TIME_SECONDS } from '@/lib/calendar'
import { spyLogger } from '@/lib/diagnostics/__tests__/spy-logger'

import { resolvePiggybackWorldTimeDelta } from './world-time'

describe('resolvePiggybackWorldTimeDelta', () => {
  it('passes a non-negative delta through unchanged', () => {
    const log = spyLogger()
    expect(resolvePiggybackWorldTimeDelta(120, 'entry_1', 0, log)).toBe(120)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('passes a zero delta through unchanged', () => {
    expect(resolvePiggybackWorldTimeDelta(0, 'entry_1', 0, spyLogger())).toBe(0)
  })

  it("clamps a negative delta to 0 and warns on the caller's logger", () => {
    const log = spyLogger()
    expect(resolvePiggybackWorldTimeDelta(-45, 'entry_1', 0, log)).toBe(0)
    expect(log.warn).toHaveBeenCalledWith('classifier.delta_clamped', {
      originalDelta: -45,
      finalDelta: 0,
      entryId: 'entry_1',
    })
  })

  it('clamps NaN to 0 rather than poisoning the running total', () => {
    const log = spyLogger()
    expect(resolvePiggybackWorldTimeDelta(Number.NaN, 'entry_1', 60, log)).toBe(0)
    expect(log.warn).toHaveBeenCalled()
  })

  // A classifier emitting a unix timestamp resolves to a year far past the
  // origin, and the reader's format walk is linear in that year.
  it("caps the delta at the remaining headroom and warns on the caller's logger", () => {
    const log = spyLogger()
    const previous = 1000
    expect(resolvePiggybackWorldTimeDelta(1.79e12, 'entry_1', previous, log)).toBe(
      MAX_WORLD_TIME_SECONDS - previous,
    )
    expect(log.warn).toHaveBeenCalledWith('classifier.delta_clamped', {
      originalDelta: 1.79e12,
      finalDelta: MAX_WORLD_TIME_SECONDS - previous,
      previousWorldTime: previous,
      entryId: 'entry_1',
    })
  })

  it('allows a delta that lands exactly on the ceiling', () => {
    const log = spyLogger()
    expect(resolvePiggybackWorldTimeDelta(MAX_WORLD_TIME_SECONDS, 'entry_1', 0, log)).toBe(
      MAX_WORLD_TIME_SECONDS,
    )
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('yields no headroom once the total is already at the ceiling', () => {
    expect(resolvePiggybackWorldTimeDelta(60, 'entry_1', MAX_WORLD_TIME_SECONDS, spyLogger())).toBe(
      0,
    )
  })
})
