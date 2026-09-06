import { describe, expect, it } from 'vitest'

import { KNN_K, RANKER_DEFAULTS } from './constants'

describe('RANKER_DEFAULTS', () => {
  it('matches canon retrieval.md → Per-type decay rates', () => {
    expect(RANKER_DEFAULTS.lambda).toEqual({
      entities: 0.025,
      lore: 0,
      happenings: 0.07,
      threads: 0.025,
      chapters: 0,
    })
  })

  it('matches canon retrieval.md → Blending default weights, summing to 1', () => {
    const { action, digest, summary, direct } = RANKER_DEFAULTS.weights
    expect([action, digest, summary, direct]).toEqual([0.3, 0.25, 0.2, 0.25])
    expect(action + digest + summary + direct).toBeCloseTo(1, 6)
  })

  it('matches the parked Tier-2 knob defaults', () => {
    expect(RANKER_DEFAULTS.lambdaDiv).toBe(0.75)
    expect(RANKER_DEFAULTS.kwBoost).toBe(0.1)
    expect(RANKER_DEFAULTS.tauRevive).toBe(0.85)
    expect(RANKER_DEFAULTS.minScoreThreshold).toBe(0.15)
    expect(RANKER_DEFAULTS.chapterBoost).toBe(1.3)
    expect(RANKER_DEFAULTS.preFilterTopN).toBe(200)
  })
})

describe('KNN_K', () => {
  it('fetches to the pre-filter bound, canon retrieval.md → pre-filter to top-200', () => {
    expect(KNN_K).toBe(200)
    // Fetching shallower than the pre-filter bound starves it: rows the
    // pre-filter would have ranked never reach it, and nothing reports the gap.
    expect(KNN_K).toBeGreaterThanOrEqual(RANKER_DEFAULTS.preFilterTopN)
  })
})
