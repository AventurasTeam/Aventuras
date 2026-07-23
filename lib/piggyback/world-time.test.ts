import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'

import { resolvePiggybackWorldTimeDelta } from './world-time'

describe('resolvePiggybackWorldTimeDelta', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('passes a non-negative delta through unchanged', () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    expect(resolvePiggybackWorldTimeDelta(120, 'entry_1')).toBe(120)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('passes a zero delta through unchanged', () => {
    expect(resolvePiggybackWorldTimeDelta(0, 'entry_1')).toBe(0)
  })

  it('clamps a negative delta to 0 and warns', () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    expect(resolvePiggybackWorldTimeDelta(-45, 'entry_1')).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith('classifier.delta_clamped', {
      originalDelta: -45,
      finalDelta: 0,
      entryId: 'entry_1',
    })
  })
})
