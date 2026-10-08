import { describe, expect, it } from 'vitest'
import { matchingStepDetail } from './matchingStep'

const stats = {
  checks: 2431,
  normalizations: 2,
  normalizedChars: 38400,
  savedMs: 972,
  elapsedMs: 12.4,
}

describe('matchingStepDetail', () => {
  it('reports the time the reused checks saved', () => {
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
        savedMs: 0,
      }),
    ).toBe('0 checks · 12 ms')
  })

  it('reports the saving when a run reused a haystack and normalized nothing', () => {
    expect(
      matchingStepDetail({ ...stats, normalizations: 0, normalizedChars: 0, savedMs: 50 }),
    ).toBe('2431 checks · 12 ms · memo saved ~50 ms (est.)')
  })

  it('shows no saving when every check normalized', () => {
    expect(matchingStepDetail({ ...stats, checks: 2, elapsedMs: 0.5 })).toBe(
      '2 checks · 0.5 ms · 38.4k chars normalized 2×',
    )
  })
})
