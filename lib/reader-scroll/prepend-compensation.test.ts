// lib/reader-scroll/prepend-compensation.test.ts
import { describe, expect, it } from 'vitest'

import { computePrependCompensation } from './prepend-compensation'

describe('computePrependCompensation', () => {
  it('adds top padding equal to the prepended block height', () => {
    const { paddingTopPx } = computePrependCompensation({ prependedBlockHeightPx: 1200 })
    expect(paddingTopPx).toBe(1200)
  })

  it('scrolls by the same delta so apparent position cancels to zero shift', () => {
    const { scrollTopDeltaPx } = computePrependCompensation({ prependedBlockHeightPx: 1200 })
    expect(scrollTopDeltaPx).toBe(1200)
  })

  it('is a no-op for a zero-height prepend', () => {
    expect(computePrependCompensation({ prependedBlockHeightPx: 0 })).toEqual({
      paddingTopPx: 0,
      scrollTopDeltaPx: 0,
    })
  })
})
