import type { RankerParams } from './types'

/**
 * v1 ships these hardcoded; the user-facing override surface is parked
 * (parked.md → Tier-2 retrieval ranker-knob tuning surface). Values are canon
 * from retrieval.md; typeOverhead is the only estimate — measured against the
 * real macros in a later task and replaced with the measurement.
 */
export const RANKER_DEFAULTS: RankerParams = {
  weights: { action: 0.35, digest: 0.35, prose: 0.3 },
  lambda: { entities: 0.025, lore: 0, happenings: 0.07, threads: 0.025, chapters: 0 },
  lambdaDiv: 0.75,
  kwBoost: 0.1,
  tauRevive: 0.85,
  minScoreThreshold: 0.15,
  chapterBoost: 1.3,
  preFilterTopN: 200,
  typeOverhead: { entities: 30, lore: 10, happenings: 20, threads: 10, chapters: 20 },
}

/** KNN fetch depth per query per type; matches the pre-filter bound. */
export const KNN_K = 200

/** Q3 keeps this many sentences (canon: 3-5). */
export const PROSE_EXTRACT_TOP_K = 4
