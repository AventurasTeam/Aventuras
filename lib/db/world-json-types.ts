export type ClassifierLifecycleState = 'idle' | 'running' | 'retrying' | 'failed-persistent'

export type ClassifierStatus = {
  state: ClassifierLifecycleState
  lastSuccessAt: number | null
  lastError: string | null
  retryCount: number
  processedThrough: number | null
}

type DropReason =
  | 'pre_filtered'
  | 'mmr_dedupe'
  | 'below_threshold'
  | 'over_budget'
  | 'candidate_too_large'
  | 'not_dropped'

type CaptureCandidate = {
  target_kind: string
  target_id: string
  display_name: string
  display_text: string
  sim_q1: number
  sim_q2: number
  sim_q3: number
  sim_blend: number
  recency_factor: number
  pin_signal: number
  kw_boost_value: number
  chapter_boost_applied: boolean
  bypass_triggered: boolean
  final_score: number
  mmr_rank: number | null
  selected: boolean
  drop_reason: DropReason
  tokens_estimated: number
  embedding_stale: boolean
  vector?: number[]
}

type PoolFunnelSummary = {
  pool_size: number
  pre_filtered_size: number
  mmr_size: number
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

type CaptureParamsSnapshot = {
  lambda: Record<string, number>
  lambda_div: Record<string, number>
  kw_boost: Record<string, number>
  tau_revive: number
  w_action: number
  w_digest: number
  w_prose: number
  min_score_threshold: number
  chapter_boost: number
  retrievalBudgets: Record<string, number>
  fullChapterInBuffer: boolean
  partialChapterBuffer: number
  protectedBuffer: number
}

export type ProbeCapturePayload = {
  branch_id: string
  target_entry_id: string
  chapter_id: string | null
  captured_at: number
  capture_mode: 'light' | 'deep'
  embedding_model_id: string
  params: CaptureParamsSnapshot
  queries: [CaptureQuery, CaptureQuery, CaptureQuery]
  pools: Record<string, CaptureCandidate[]>
  funnels: Record<string, PoolFunnelSummary>
  structural_floor: StructuralFloorRow[]
  stale_counts: Record<string, number>
}
