import type { RankerParams } from './types'

/**
 * v1 ships these hardcoded; the user-facing override surface is parked
 * (parked.md → Tier-2 retrieval ranker-knob tuning surface). Values are canon
 * from retrieval.md; typeOverhead is measured (retrieval.md → Token estimation)
 * against the shipped memory-blocks macro by
 * lib/prompts/bundled/memory-blocks.test.ts, which fails when the macro moves
 * and the constant does not.
 */
export const RANKER_DEFAULTS = {
  // retrieval.md → Blending. Four slots, though only three can be live until the
  // Q4 emitter ships: with no emitted query the `direct` share re-normalizes
  // away, which is the same mechanism an absent Q2 or Q3 already uses.
  weights: { action: 0.3, digest: 0.25, summary: 0.2, direct: 0.25 },
  lambda: { entities: 0.025, lore: 0, happenings: 0.07, threads: 0.025, chapters: 0 },
  // Non-zero only where lambda is 0 AND the type carries a pin signal, which is
  // lore alone: happenings' decay_resistance already acts through the exponent,
  // and entities / threads / chapters have no pin signal to spend.
  pinBoost: { entities: 0, lore: 0.25, happenings: 0, threads: 0, chapters: 0 },
  lambdaDiv: 0.75,
  kwBoost: 0.1,
  tauRevive: 0.85,
  minScoreThreshold: 0.15,
  chapterBoost: 1.3,
  preFilterTopN: 200,
  typeOverhead: { entities: 11, lore: 4, happenings: 5, threads: 4, chapters: 4 },
} as const satisfies RankerParams

/**
 * KNN fetch depth per query per type. Deliberately NOT tied to
 * `preFilterTopN` despite sharing a value: that one is canon and cuts the
 * *boosted* score after `score` has run, while this gates pool membership
 * before recency, kw_boost, pin_signal or the chapter boost exist. Reading
 * them as the same bound is what hid the chapter-match gap — see
 * `runRetrievalPass`, which admits chapter-range happenings separately.
 */
export const KNN_K = 200
