import type { DropReason, VecTargetKind } from '@/lib/db'

/** Row kind. Singular, matching VecTargetKind and the probe's target_kind. */
export type CandidateKind = VecTargetKind

export const TYPE_OF_KIND = {
  entity: 'entities',
  lore: 'lore',
  happening: 'happenings',
  thread: 'threads',
  chapter: 'chapters',
} as const satisfies Record<CandidateKind, string>

/**
 * Budget/pool key. Plural, matching stories.settings.retrievalBudgets. Derived
 * from the map rather than declared beside it: surjectivity is then structural,
 * so a type no kind maps to cannot exist to leave an undefined pool hole, and a
 * duplicated value fails the per-type literals that key on this.
 */
export type RetrievalType = (typeof TYPE_OF_KIND)[CandidateKind]

/** Positional value-array query seam, matching lib/db/runtime/exec.ts's queryRows. */
export type QueryAll = (sql: string, params: unknown[]) => Promise<unknown[][]>

/**
 * What every candidate carries regardless of kind. Every field the ranker reads
 * is here or on the variant — it never queries for more, which is what makes it
 * replayable.
 */
type CandidateBase = {
  id: string
  /** Display name/title, denormalized for the probe's capture snapshot. */
  displayName: string
  /** Exactly the text the prompt will carry; token cost is measured on it. */
  renderedText: string
  /**
   * Cosine similarity to Q1/Q2/Q3, computed in JS over the stored vectors.
   * `null` means that query produced no vector this turn — which `0`, a
   * genuine orthogonal similarity, cannot be distinguished from.
   */
  sims: readonly [number | null, number | null, number | null]
  /** Unit-norm, same space as the queries. MMR's pairwise similarity input. */
  vector: Float32Array
  /** Chapters since the row became relevant. 0 for every row until M5 closes one. */
  chaptersOld: number
  /** decay_resistance for awareness, priority/100 for lore, 0 for the rest. */
  pinSignal: number
  /** Keyword-index terms this row matched; empty means no boost. */
  keywordHits: readonly string[]
  /** Flag at pool-build time. Stale rows never enter a pool, so this is false today. */
  embeddingStale: boolean
}

/** The three awareness-derived fields exist on no other kind. */
export type HappeningCandidate = CandidateBase & {
  kind: 'happening'
  /** common_knowledge = 1 skips recency and pin entirely. */
  commonKnowledge: boolean
  /** The entry the happening occurred at, for the chapter boost. */
  occurredAtEntryId: string | null
  /** Awareness rows that put this happening in the pool; retrieval_count targets. */
  awarenessIds: readonly string[]
}

export type SimpleCandidate = CandidateBase & { kind: Exclude<CandidateKind, 'happening'> }

/** One row that reached a type's ranker pool. */
export type Candidate = HappeningCandidate | SimpleCandidate

export const isHappeningCandidate = (c: Candidate): c is HappeningCandidate =>
  c.kind === 'happening'

export type { DropReason }

/**
 * Per-candidate trace, contract C4. camelCase here; Slice 3.5 maps to the
 * snake_case CaptureCandidate in lib/db/world-json-types.ts. Adding a field is
 * a contract change. Every scoring field is the value the scorer read,
 * post-clamp.
 */
export type CandidateTrace = {
  kind: CandidateKind
  id: string
  displayName: string
  simQ1: number | null
  simQ2: number | null
  simQ3: number | null
  simBlend: number
  recencyFactor: number
  pinSignal: number
  chaptersOld: number
  /**
   * Exactly the text the prompt will carry, and the tokenizer's input whenever
   * the cost is computed rather than replayed from a capture. Null for a
   * pre-filtered row, which carries no token estimate either — it can never be
   * seated, so neither is ever read.
   */
  renderedText: string | null
  /**
   * Happenings only. score() forces pinSignal 0 and recencyFactor 1 on these,
   * which a captured pin_signal of 0 cannot be distinguished from.
   */
  commonKnowledge?: boolean
  kwBoostValue: number
  chapterBoostApplied: boolean
  bypassTriggered: boolean
  finalScore: number
  /** null when the candidate was pre-filtered out before MMR ran. */
  mmrRank: number | null
  selected: boolean
  dropReason: DropReason
  /** null when the candidate was pre-filtered out — it can never be seated. */
  tokensEstimated: number | null
  embeddingStale: boolean
}

export type PoolFunnel = {
  poolSize: number
  preFilteredSize: number
  selectedCount: number
  tokensUsed: number
  typeBudget: number
}

export type RankedType = {
  selected: readonly Candidate[]
  traces: readonly CandidateTrace[]
  funnel: PoolFunnel
  /**
   * Every row that entered the pool, in input order. `selected` holds only the
   * seated ones, so a deep probe capture — which stores a vector per pool row —
   * has nowhere else to read them from.
   */
  pool: readonly Candidate[]
}

export type QueryWeights = { action: number; digest: number; prose: number }

/**
 * Every tunable the ranker reads. Frozen into each probe capture verbatim, and
 * readonly throughout: RANKER_DEFAULTS is exported from the barrel, so a
 * writable field would let one importer retune the ranker for every later reader
 * in the same process (code-conventions.md → Read-view immutability).
 */
export type RankerParams = {
  readonly weights: Readonly<QueryWeights>
  readonly lambda: Readonly<Record<RetrievalType, number>>
  /** Pin channel for types whose `lambda` is 0, where the decay exponent carries nothing. */
  readonly pinBoost: Readonly<Record<RetrievalType, number>>
  readonly lambdaDiv: number
  readonly kwBoost: number
  readonly tauRevive: number
  readonly minScoreThreshold: number
  readonly chapterBoost: number
  readonly preFilterTopN: number
  readonly typeOverhead: Readonly<Record<RetrievalType, number>>
}

/** Which of Q1/Q2/Q3 had non-empty text and was submitted to the embedder. */
export type QueryTextPresence = readonly [boolean, boolean, boolean]

export type RankAllInput = {
  pools: Record<RetrievalType, readonly Candidate[]>
  budgets: Record<RetrievalType, number>
  params: RankerParams
  /** Entry ids covered by each closed chapter, for the chapter-match boost. */
  chapterRanges: ReadonlyMap<string, ReadonlySet<string>>
  /** Injected so the ranker stays pure — tokens.ts is the production impl. */
  countTokens: (text: string) => number
}
