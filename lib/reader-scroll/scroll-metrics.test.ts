// lib/reader-scroll/scroll-metrics.test.ts
import { describe, expect, it } from 'vitest'

import { computeScrollMetrics } from './scroll-metrics'

describe('computeScrollMetrics', () => {
  it('reports distance from bottom', () => {
    expect(computeScrollMetrics({ scrollTop: 100, clientHeight: 600, scrollHeight: 2000 })).toEqual(
      { distanceFromBottomPx: 1300, withinTopViewport: true },
    )
  })

  it('is at bottom when scrolled fully', () => {
    const m = computeScrollMetrics({ scrollTop: 1400, clientHeight: 600, scrollHeight: 2000 })
    expect(m.distanceFromBottomPx).toBe(0)
    expect(m.withinTopViewport).toBe(false)
  })

  it('marks within-top when scrollTop is inside one viewport height', () => {
    expect(
      computeScrollMetrics({ scrollTop: 600, clientHeight: 600, scrollHeight: 2000 })
        .withinTopViewport,
    ).toBe(true)
    expect(
      computeScrollMetrics({ scrollTop: 601, clientHeight: 600, scrollHeight: 2000 })
        .withinTopViewport,
    ).toBe(false)
  })

  it('handles content shorter than the viewport', () => {
    const m = computeScrollMetrics({ scrollTop: 0, clientHeight: 600, scrollHeight: 400 })
    expect(m.distanceFromBottomPx).toBeLessThanOrEqual(0)
    expect(m.withinTopViewport).toBe(true)
  })
})
