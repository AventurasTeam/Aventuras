import { describe, expect, it } from 'vitest'

import { RANKER_DEFAULTS } from './constants'

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
    const { action, digest, prose } = RANKER_DEFAULTS.weights
    expect([action, digest, prose]).toEqual([0.35, 0.35, 0.3])
    expect(action + digest + prose).toBeCloseTo(1, 6)
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
