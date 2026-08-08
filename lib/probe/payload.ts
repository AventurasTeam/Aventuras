import { CAPTURE_VERSION, type ProbeCapturePayload, type VecTargetKind } from '@/lib/db'
import {
  countTokens,
  TOKENIZER_IDENTITY,
  type CandidateTrace,
  type QuerySpec,
  type QueryStack,
  type RankedType,
  type RankerParams,
  type RetrievalOutcome,
  type RetrievalType,
  type StructuralFloor,
} from '@/lib/retrieval'

export type CapturePayloadInput = {
  branchId: string
  targetEntryId: string
  chapterId: string | null
  capturedAt: number
  embeddingModelId: string
  mode: 'light' | 'deep'
  params: RankerParams
  settings: {
    retrievalBudgets: Record<RetrievalType, number>
    fullChapterInBuffer: boolean
    partialChapterBuffer: number
    protectedBuffer: number
  }
  outcome: RetrievalOutcome
  /** Deep mode only; Q1/Q2/Q3 order, null where a query produced no vector. */
  queryVectors?: readonly (Float32Array | null)[]
}

const candidateOf = (
  t: CandidateTrace,
  mode: 'light' | 'deep',
  vector: Float32Array | undefined,
) => ({
  target_kind: t.kind,
  target_id: t.id,
  display_name: t.displayName,
  display_text: t.renderedText,
  sim_q1: t.simQ1,
  sim_q2: t.simQ2,
  sim_q3: t.simQ3,
  sim_blend: t.simBlend,
  recency_factor: t.recencyFactor,
  pin_signal: t.pinSignal,
  chapters_old: t.chaptersOld,
  ...(t.commonKnowledge === undefined ? {} : { common_knowledge: t.commonKnowledge }),
  kw_boost_value: t.kwBoostValue,
  chapter_boost_applied: t.chapterBoostApplied,
  bypass_triggered: t.bypassTriggered,
  final_score: t.finalScore,
  mmr_rank: t.mmrRank,
  selected: t.selected,
  drop_reason: t.dropReason,
  tokens_estimated: t.tokensEstimated,
  embedding_stale: t.embeddingStale,
  ...(mode === 'deep' && vector ? { vector: [...vector] } : {}),
})

/**
 * Deep-mode vectors come from `bundle.pool`, not `bundle.selected`: `traces`
 * carries no vector, and MMR replay needs one per pool row, not just the
 * seated ones.
 */
const poolOf = (
  bundle: RankedType | undefined,
  mode: 'light' | 'deep',
): ProbeCapturePayload['pools'][RetrievalType] => {
  if (bundle === undefined) return []
  const vectorById = new Map(bundle.pool.map((c) => [c.id, c.vector]))
  return bundle.traces.map((t) => candidateOf(t, mode, vectorById.get(t.id)))
}

const funnelOf = (bundle: RankedType | undefined): ProbeCapturePayload['funnels'][RetrievalType] =>
  bundle === undefined
    ? { pool_size: 0, pre_filtered_size: 0, selected_count: 0, tokens_used: 0, type_budget: 0 }
    : {
        pool_size: bundle.funnel.poolSize,
        pre_filtered_size: bundle.funnel.preFilteredSize,
        selected_count: bundle.funnel.selectedCount,
        tokens_used: bundle.funnel.tokensUsed,
        type_budget: bundle.funnel.typeBudget,
      }

const queryOf = (
  q: QuerySpec,
  mode: 'light' | 'deep',
  vector: Float32Array | null | undefined,
) => ({
  text: q.text,
  token_count: countTokens(q.text),
  source: q.source,
  ...(q.sentenceScores ? { sentence_scores: q.sentenceScores } : {}),
  ...(mode === 'deep' && vector ? { vector: [...vector] } : {}),
})

const EMPTY_QUERY: QuerySpec = { text: '', source: 'user_action' }

const queriesOf = (
  stack: QueryStack | null,
  mode: 'light' | 'deep',
  vectors: readonly (Float32Array | null)[] | undefined,
): ProbeCapturePayload['queries'] => {
  if (stack === null) {
    const empty = queryOf(EMPTY_QUERY, mode, null)
    return [empty, empty, empty]
  }
  return [
    queryOf(stack.q1, mode, vectors?.[0]),
    queryOf(stack.q2, mode, vectors?.[1]),
    queryOf(stack.q3, mode, vectors?.[2]),
  ]
}

const floorRowsOf = (floor: StructuralFloor | null): ProbeCapturePayload['structural_floor'] => {
  if (floor === null) return []
  const rows: ProbeCapturePayload['structural_floor'] = []
  const push = (kind: VecTargetKind, id: string, text: string) =>
    rows.push({ target_kind: kind, target_id: id, tokens: countTokens(text) })

  for (const e of floor.sceneEntities) push('entity', e.id, e.description ?? e.name)
  if (floor.currentLocation) {
    push(
      'entity',
      floor.currentLocation.id,
      floor.currentLocation.description ?? floor.currentLocation.name,
    )
  }
  for (const t of floor.activeThreads) push('thread', t.id, t.description ?? t.title)
  for (const e of floor.alwaysEntities) push('entity', e.id, e.description ?? e.name)
  for (const l of floor.alwaysLore) push('lore', l.id, l.body ?? l.title)
  for (const t of floor.alwaysThreads) push('thread', t.id, t.description ?? t.title)
  return rows
}

export function buildCapturePayload(input: CapturePayloadInput): ProbeCapturePayload {
  const { outcome, mode } = input
  const stack = outcome.ok ? outcome.queries : outcome.partial.queries
  const floor = outcome.ok ? outcome.floor : outcome.partial.floor
  const bundles: Partial<Record<RetrievalType, RankedType>> = outcome.ok
    ? outcome.bundles
    : outcome.partial.bundles

  return {
    branch_id: input.branchId,
    target_entry_id: input.targetEntryId,
    chapter_id: input.chapterId,
    captured_at: input.capturedAt,
    capture_mode: mode,
    embedding_model_id: input.embeddingModelId,
    capture_version: CAPTURE_VERSION,
    tokenizer: { ...TOKENIZER_IDENTITY },
    params: {
      ranker: input.params,
      ...input.settings,
      retrievalBudgets: { ...input.settings.retrievalBudgets },
    },
    queries: queriesOf(stack, mode, input.queryVectors),
    pools: {
      entities: poolOf(bundles.entities, mode),
      lore: poolOf(bundles.lore, mode),
      happenings: poolOf(bundles.happenings, mode),
      threads: poolOf(bundles.threads, mode),
      chapters: poolOf(bundles.chapters, mode),
    },
    funnels: {
      entities: funnelOf(bundles.entities),
      lore: funnelOf(bundles.lore),
      happenings: funnelOf(bundles.happenings),
      threads: funnelOf(bundles.threads),
      chapters: funnelOf(bundles.chapters),
    },
    structural_floor: floorRowsOf(floor),
    stale_counts: outcome.ok
      ? { ...outcome.staleCounts }
      : { entities: 0, lore: 0, happenings: 0, threads: 0, chapters: 0 },
  }
}
