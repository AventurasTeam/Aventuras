import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_WORLD_TIME_SECONDS } from '@/lib/calendar'
import { logger } from '@/lib/diagnostics'

import { resolvePiggybackWorldTimeDelta } from './world-time'

describe('resolvePiggybackWorldTimeDelta', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('passes a non-negative delta through unchanged', () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    expect(resolvePiggybackWorldTimeDelta(120, 'entry_1', 0)).toBe(120)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('passes a zero delta through unchanged', () => {
    expect(resolvePiggybackWorldTimeDelta(0, 'entry_1', 0)).toBe(0)
  })

  it('clamps a negative delta to 0 and warns', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    expect(resolvePiggybackWorldTimeDelta(-45, 'entry_1', 0)).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith('classifier.delta_clamped', {
      originalDelta: -45,
      finalDelta: 0,
      entryId: 'entry_1',
    })
  })

  it('clamps NaN to 0 rather than poisoning the running total', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    expect(resolvePiggybackWorldTimeDelta(Number.NaN, 'entry_1', 60)).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  // A classifier emitting a unix timestamp resolves to a year far past the
  // origin, and the reader's format walk is linear in that year.
  it('caps the delta at the remaining headroom and warns', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const previous = 1000
    expect(resolvePiggybackWorldTimeDelta(1.79e12, 'entry_1', previous)).toBe(
      MAX_WORLD_TIME_SECONDS - previous,
    )
    expect(warnSpy).toHaveBeenCalledWith('classifier.delta_clamped', {
      originalDelta: 1.79e12,
      finalDelta: MAX_WORLD_TIME_SECONDS - previous,
      previousWorldTime: previous,
      entryId: 'entry_1',
    })
  })

  it('allows a delta that lands exactly on the ceiling', () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    expect(resolvePiggybackWorldTimeDelta(MAX_WORLD_TIME_SECONDS, 'entry_1', 0)).toBe(
      MAX_WORLD_TIME_SECONDS,
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('yields no headroom once the total is already at the ceiling', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    expect(resolvePiggybackWorldTimeDelta(60, 'entry_1', MAX_WORLD_TIME_SECONDS)).toBe(0)
  })
})
