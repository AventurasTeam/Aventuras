import { describe, expect, it } from 'vitest'

import { RANKER_DEFAULTS } from '@/lib/retrieval'

import { assertRankerParams } from './validate'

describe('assertRankerParams', () => {
  it('accepts the shipped defaults', () => {
    expect(() => assertRankerParams(RANKER_DEFAULTS)).not.toThrow()
  })

  it.each([
    ['lambdaDiv at 0 selects nothing silently', { lambdaDiv: 0 }],
    ['lambdaDiv above 1 inverts the diversity term', { lambdaDiv: 1.5 }],
    ['a negative tauRevive bypasses the decay model entirely', { tauRevive: -0.1 }],
    ['a negative kwBoost penalizes a keyword match', { kwBoost: -1 }],
    ['a negative chapterBoost flips the sign of every boosted score', { chapterBoost: -1 }],
    ['preFilterTopN at 0 keeps no candidates', { preFilterTopN: 0 }],
    [
      'a negative minScoreThreshold lets every candidate clear the floor',
      { minScoreThreshold: -0.1 },
    ],
  ])('rejects %s', (_label, patch) => {
    expect(() => assertRankerParams({ ...RANKER_DEFAULTS, ...patch })).toThrow(/ranker param/i)
  })

  it('rejects a negative per-type pinBoost, which inverts the pin', () => {
    expect(() =>
      assertRankerParams({
        ...RANKER_DEFAULTS,
        pinBoost: { ...RANKER_DEFAULTS.pinBoost, lore: -0.5 },
      }),
    ).toThrow(/pinBoost/)
  })

  // Anchored on the dot: a bare /lambda/ also matches the unrelated lambdaDiv field.
  it('rejects a negative per-type lambda, which turns decay into growth', () => {
    expect(() =>
      assertRankerParams({
        ...RANKER_DEFAULTS,
        lambda: { ...RANKER_DEFAULTS.lambda, happenings: -0.07 },
      }),
    ).toThrow(/lambda\.happenings/)
  })

  it('rejects a negative per-query weight, which can drive sim_blend negative', () => {
    expect(() =>
      assertRankerParams({
        ...RANKER_DEFAULTS,
        weights: { ...RANKER_DEFAULTS.weights, prose: -0.1 },
      }),
    ).toThrow(/weights/)
  })

  it('rejects a negative typeOverhead, which undercounts a candidate token cost', () => {
    expect(() =>
      assertRankerParams({
        ...RANKER_DEFAULTS,
        typeOverhead: { ...RANKER_DEFAULTS.typeOverhead, lore: -1 },
      }),
    ).toThrow(/typeOverhead/)
  })
})
