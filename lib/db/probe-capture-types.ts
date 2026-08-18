import type { EmbedderErrorKind } from '@/lib/embedder'
import type { QuerySpec, RankerParams, RetrievalType } from '@/lib/retrieval'

import type { VecTargetKind } from './embeddings/vec-tables'

/**
 * Why a candidate did not reach the prompt. Owned here because the probe capture
 * persists it; lib/retrieval imports this rather than restating it, so adding a
 * reason cannot land on one side of the snake_case mapping only.
 */
export type DropReason =
  | 'pre_filtered'
  | 'below_threshold'
  | 'over_budget'
  | 'candidate_too_large'
  | 'not_dropped'

type CaptureCandidate = {
  target_kind: VecTargetKind
  target_id: string
  display_name: string
  /**
   * The exact string the ranker measured. Null for a pre-filtered row: it can
   * never be seated by the simulator, so its text and token cost are never read.
   */
  display_text: string | null
  /** Null where that query produced no vector — which 0 cannot express. */
  sim_q1: number | null
  sim_q2: number | null
  sim_q3: number | null
  sim_blend: number
  recency_factor: number
  pin_signal: number
  /** Clamped as the decay exponent read it, so a replay cannot diverge. */
  chapters_old: number
  /** Happenings only; forces pin_signal 0 and recency_factor 1 in the ranker. */
  common_knowledge?: boolean
  kw_boost_value: number
  chapter_boost_applied: boolean
  bypass_triggered: boolean
  final_score: number
  mmr_rank: number | null
  selected: boolean
  drop_reason: DropReason
  tokens_estimated: number | null
  embedding_stale: boolean
  vector?: number[]
}

type PoolFunnelSummary = {
  pool_size: number
  pre_filtered_size: number
  selected_count: number
  tokens_used: number
  type_budget: number
}

type StructuralFloorRow = {
  target_kind: VecTargetKind
  target_id: string
  tokens: number
}

type CaptureQuery = {
  text: string
  token_count: number
  source: QuerySpec['source']
  sentence_scores?: number[]
}

/** A new ranker tunable must be a type error here, not a silently absent capture field. */
type CaptureParamsSnapshot = {
  ranker: RankerParams
  retrievalBudgets: Record<RetrievalType, number>
  fullChapterInBuffer: boolean
  partialChapterBuffer: number
  protectedBuffer: number
}

/**
 * Which vocabulary priced tokens_estimated; decodeCapture warns across a change.
 * `encoding` is a free string, not the current TOKENIZER_IDENTITY literal: a
 * stored capture's type must not follow whatever today's code encodes with.
 */
type CaptureTokenizer = { encoding: string; version: string }

/**
 * Bumped when a captured field's shape or meaning changes, so a decode can
 * warn instead of silently misreading an older payload as the current type.
 */
export const CAPTURE_VERSION = 2 as const

export type ProbeCapturePayload = {
  capture_version: number
  branch_id: string
  target_entry_id: string
  chapter_id: string | null
  captured_at: number
  capture_mode: 'light' | 'deep'
  embedding_model_id: string
  tokenizer: CaptureTokenizer
  params: CaptureParamsSnapshot
  queries: [CaptureQuery, CaptureQuery, CaptureQuery]
  pools: Record<RetrievalType, CaptureCandidate[]>
  funnels: Record<RetrievalType, PoolFunnelSummary>
  structural_floor: StructuralFloorRow[]
  /**
   * Prompt-buffer cost as one number, not floor rows: the floor is a token
   * ledger and buffered entries carry no retrieval identity, so N rows would
   * add bulk without adding a tunable. Normally the largest floor term, so a
   * capture without it under-reports what the pools competed over
   * (probe.md → Structural floor).
   */
  prompt_buffer_tokens: number
  stale_counts: Record<RetrievalType, number>
  /**
   * Mirrors the row's `failure_reason` so a payload alone can refuse
   * simulation — replayType never sees the row (probe.md → Failed captures).
   */
  failure_reason: EmbedderErrorKind | null
}
