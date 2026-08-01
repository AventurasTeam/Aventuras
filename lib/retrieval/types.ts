import type { VecTargetKind } from '@/lib/db'

/** Budget/pool key. Plural, matching stories.settings.retrievalBudgets. */
export type RetrievalType = 'entities' | 'lore' | 'happenings' | 'threads' | 'chapters'

/** Row kind. Singular, matching VecTargetKind and the probe's target_kind. */
export type CandidateKind = VecTargetKind

export const TYPE_OF_KIND: Record<CandidateKind, RetrievalType> = {
  entity: 'entities',
  lore: 'lore',
  happening: 'happenings',
  thread: 'threads',
  chapter: 'chapters',
}

/** Positional value-array query seam, matching lib/db/runtime/exec.ts's queryRows. */
export type QueryAll = (sql: string, params: unknown[]) => Promise<unknown[][]>

/**
 * One row that reached a type's ranker pool. Every field the ranker reads is
 * here — it never queries for more, which is what makes it replayable.
 */
export type Candidate = {
  kind: CandidateKind
  id: string
  /** Display name/title, denormalized for the probe's capture snapshot. */
  displayName: string
  /** Exactly the text the prompt will carry; token cost is measured on it. */
  renderedText: string
  /** Cosine similarity to Q1/Q2/Q3, computed in JS over the stored vectors. */
  sims: readonly [number, number, number]
  /** Unit-norm, same space as the queries. MMR's pairwise similarity input. */
  vector: Float32Array
  /** Chapters since the row became relevant. 0 for every row until M5 closes one. */
  chaptersOld: number
  /** decay_resistance for awareness, priority/100 for lore, 0 for the rest. */
  pinSignal: number
  /** Happenings with common_knowledge = 1 skip recency and pin entirely. */
  commonKnowledge: boolean
  /** Keyword-index terms this row matched; empty means no boost. */
  keywordHits: readonly string[]
  /** Happenings only — the entry the happening occurred at, for the chapter boost. */
  occurredAtEntryId: string | null
  /** Awareness rows that put this happening in the pool; retrieval_count targets. */
  awarenessIds: readonly string[]
  /** Flag at pool-build time. Stale rows never enter a pool, so this is false today. */
  embeddingStale: boolean
}

export type DropReason =
  | 'pre_filtered'
  | 'mmr_dedupe'
  | 'below_threshold'
  | 'over_budget'
  | 'candidate_too_large'
  | 'not_dropped'

/**
 * Per-candidate trace, contract C4. camelCase here; Slice 3.5 maps to the
 * snake_case CaptureCandidate in lib/db/world-json-types.ts. Adding a field is
 * a contract change.
 */
export type CandidateTrace = {
  kind: CandidateKind
  id: string
  displayName: string
  simQ1: number
  simQ2: number
  simQ3: number
  simBlend: number
  recencyFactor: number
  pinSignal: number
  kwBoostValue: number
  chapterBoostApplied: boolean
  bypassTriggered: boolean
  finalScore: number
  /** null when the candidate was pre-filtered out before MMR ran. */
  mmrRank: number | null
  selected: boolean
  dropReason: DropReason
  tokensEstimated: number
  embeddingStale: boolean
}

export type PoolFunnel = {
  poolSize: number
  preFilteredSize: number
  mmrSize: number
  selectedCount: number
  tokensUsed: number
  typeBudget: number
}

export type RankedType = {
  selected: readonly Candidate[]
  traces: readonly CandidateTrace[]
  funnel: PoolFunnel
}

export type QueryWeights = { action: number; digest: number; prose: number }

/** Every tunable the ranker reads. Frozen into each probe capture verbatim. */
export type RankerParams = {
  weights: QueryWeights
  lambda: Record<RetrievalType, number>
  lambdaDiv: number
  kwBoost: number
  tauRevive: number
  minScoreThreshold: number
  chapterBoost: number
  preFilterTopN: number
  typeOverhead: Record<RetrievalType, number>
}

/** Which of Q1/Q2/Q3 actually produced a vector this turn. */
export type QueryPresence = readonly [boolean, boolean, boolean]

export type RankAllInput = {
  pools: Record<RetrievalType, readonly Candidate[]>
  budgets: Record<RetrievalType, number>
  params: RankerParams
  presence: QueryPresence
  /** Entry ids covered by each closed chapter, for the chapter-match boost. */
  chapterRanges: ReadonlyMap<string, ReadonlySet<string>>
  /** Injected so the ranker stays pure — tokens.ts is the production impl. */
  countTokens: (text: string) => number
}
