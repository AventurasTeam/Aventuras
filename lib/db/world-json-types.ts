import type { RankerParams } from '@/lib/retrieval'

export type ClassifierLifecycleState = 'idle' | 'running' | 'retrying' | 'failed-persistent'

export type ClassifierStatus = {
  state: ClassifierLifecycleState
  lastSuccessAt: number | null
  lastError: string | null
  retryCount: number
  processedThrough: number | null
}

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
  target_kind: string
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
  target_kind: string
  target_id: string
  tokens: number
}

type CaptureQuery = {
  text: string
  token_count: number
  source: string
  sentence_scores?: number[]
  vector?: number[]
}

/**
 * The ranker's own tunables verbatim beside the story-settings knobs that shape
 * the pass. Embedding RankerParams rather than restating it is what makes a new
 * tunable a type error here instead of a silently absent capture field.
 */
type CaptureParamsSnapshot = {
  ranker: RankerParams
  retrievalBudgets: Record<string, number>
  fullChapterInBuffer: boolean
  partialChapterBuffer: number
  protectedBuffer: number
}

/** Which vocabulary priced tokens_estimated; a later replay warns across a change. */
type CaptureTokenizer = { encoding: string; version: string }

export type ProbeCapturePayload = {
  branch_id: string
  target_entry_id: string
  chapter_id: string | null
  captured_at: number
  capture_mode: 'light' | 'deep'
  embedding_model_id: string
  tokenizer: CaptureTokenizer
  params: CaptureParamsSnapshot
  queries: [CaptureQuery, CaptureQuery, CaptureQuery]
  pools: Record<string, CaptureCandidate[]>
  funnels: Record<string, PoolFunnelSummary>
  structural_floor: StructuralFloorRow[]
  stale_counts: Record<string, number>
}
