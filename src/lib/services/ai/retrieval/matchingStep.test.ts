import { describe, expect, it } from 'vitest'
import { matchingStepDetail } from './matchingStep'

const stats = {
  checks: 2431,
  normalizations: 2,
  normalizedChars: 38400,
  normalizeMs: 0.8,
  elapsedMs: 12.4,
}

describe('matchingStepDetail', () => {
  it('prices the reused checks at the average normalization', () => {
    expect(matchingStepDetail(stats)).toBe(
      '2431 checks · 12 ms · 38.4k chars normalized 2× · memo saved ~972 ms (est.)',
    )
  })

  it('shows no normalization or saving when nothing was checked', () => {
    expect(
      matchingStepDetail({
        ...stats,
        checks: 0,
        normalizations: 0,
        normalizedChars: 0,
        normalizeMs: 0,
      }),
    ).toBe('0 checks · 12 ms')
  })

  it('shows no saving when every check normalized', () => {
    expect(matchingStepDetail({ ...stats, checks: 2, elapsedMs: 0.5 })).toBe(
      '2 checks · 0.5 ms · 38.4k chars normalized 2×',
    )
  })
})
