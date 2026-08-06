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
  weights: { action: 0.35, digest: 0.35, prose: 0.3 },
  lambda: { entities: 0.025, lore: 0, happenings: 0.07, threads: 0.025, chapters: 0 },
  lambdaDiv: 0.75,
  kwBoost: 0.1,
  tauRevive: 0.85,
  minScoreThreshold: 0.15,
  chapterBoost: 1.3,
  preFilterTopN: 200,
  typeOverhead: { entities: 11, lore: 4, happenings: 5, threads: 4, chapters: 4 },
} as const satisfies RankerParams

/** KNN fetch depth per query per type; matches the pre-filter bound. */
export const KNN_K = 200

/** Q3 keeps this many sentences (canon: 3-5). */
export const PROSE_EXTRACT_TOP_K = 4
