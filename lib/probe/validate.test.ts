import { describe, expect, it } from 'vitest'

import { RANKER_DEFAULTS, type RankerParams } from '@/lib/retrieval'

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
    ['chapterBoost below 1 demotes a match instead of lifting it', { chapterBoost: 0.5 }],
    ['a fractional preFilterTopN silently truncates through slice', { preFilterTopN: 2.5 }],
  ])('rejects %s', (_label, patch) => {
    expect(() => assertRankerParams({ ...RANKER_DEFAULTS, ...patch })).toThrow(/ranker param/i)
  })

  // Neither comparison in inRange treats these as out-of-bounds: undefined and
  // NaN fail every `<`/`>` check, and Infinity clears every field whose upper
  // bound is itself Infinity. isFinite is the only clause that rejects them.
  it('rejects a missing tauRevive, which relational comparisons alone let through', () => {
    expect(() =>
      assertRankerParams({ ...RANKER_DEFAULTS, tauRevive: undefined } as unknown as RankerParams),
    ).toThrow(/ranker param/i)
  })

  it('rejects an infinite kwBoost, whose [0, Infinity] range has no finite upper bound to trip', () => {
    expect(() => assertRankerParams({ ...RANKER_DEFAULTS, kwBoost: Infinity })).toThrow(
      /ranker param/i,
    )
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

  // A per-type record missing a key (an older capture predating a tunable)
  // reaches the ranker's decay exponent as NaN rather than as a caught error.
  it('rejects a lambda record missing a type, which the ranker would read as NaN', () => {
    const { chapters, ...rest } = RANKER_DEFAULTS.lambda
    expect(() =>
      assertRankerParams({ ...RANKER_DEFAULTS, lambda: rest as unknown as RankerParams['lambda'] }),
    ).toThrow(/lambda\.chapters/)
  })

  it('rejects a pinBoost record missing a type', () => {
    const { entities, ...rest } = RANKER_DEFAULTS.pinBoost
    expect(() =>
      assertRankerParams({
        ...RANKER_DEFAULTS,
        pinBoost: rest as unknown as RankerParams['pinBoost'],
      }),
    ).toThrow(/pinBoost\.entities/)
  })

  it('rejects a typeOverhead record missing a type', () => {
    const { threads, ...rest } = RANKER_DEFAULTS.typeOverhead
    expect(() =>
      assertRankerParams({
        ...RANKER_DEFAULTS,
        typeOverhead: rest as unknown as RankerParams['typeOverhead'],
      }),
    ).toThrow(/typeOverhead\.threads/)
  })
})
