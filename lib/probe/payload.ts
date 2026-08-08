import { CAPTURE_VERSION, type ProbeCapturePayload, type VecTargetKind } from '@/lib/db'
import {
  countTokens,
  ENTITY_FRAMING,
  TOKENIZER_IDENTITY,
  type CandidateTrace,
  type EntityRow,
  type LoreRow,
  type QuerySpec,
  type QueryStack,
  type RankedType,
  type RankerParams,
  type RetrievalOutcome,
  type RetrievalType,
  type StructuralFloor,
  type ThreadRow,
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
  /** Deep mode only; Q1/Q2/Q3 order, null where a query produced no vector — matches distributeQueryVectors' return shape. */
  queryVectors?: readonly [Float32Array | null, Float32Array | null, Float32Array | null]
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
  ...(q.sentenceScores ? { sentence_scores: [...q.sentenceScores] } : {}),
  ...(mode === 'deep' && vector ? { vector: [...vector] } : {}),
})

const queriesOf = (
  stack: QueryStack | null,
  mode: 'light' | 'deep',
  vectors: readonly [Float32Array | null, Float32Array | null, Float32Array | null] | undefined,
): ProbeCapturePayload['queries'] => {
  if (stack === null) {
    return [
      queryOf({ text: '', source: 'user_action' }, mode, null),
      queryOf({ text: '', source: 'structural_digest' }, mode, null),
      queryOf({ text: '', source: 'prose_extract' }, mode, null),
    ]
  }
  return [
    queryOf(stack.q1, mode, vectors?.[0]),
    queryOf(stack.q2, mode, vectors?.[1]),
    queryOf(stack.q3, mode, vectors?.[2]),
  ]
}

// run.ts's lines() isn't exported from lib/retrieval; reimplemented here so a
// blank field doesn't leave its join separator behind.
const lines = (...parts: (string | null)[]): string =>
  parts.filter((p) => p !== null && p !== '').join('\n')

// Mirrors run.ts's entity/lore/thread pool projections exactly (ENTITY_FRAMING
// + the same head/body join), so a floor row prices the same way the ranker
// would price the identical row shape in a pool — the number this field
// exists to report (probe.md -> the floor "surfaces what budget the per-type
// pools actually competed over").
const entityFloorText = (e: Pick<EntityRow, 'name' | 'description' | 'status'>): string => {
  const framing = ENTITY_FRAMING[e.status]
  const head = framing === undefined ? e.name : `${e.name} (${framing})`
  return e.description ? `${head}: ${e.description}` : head
}

const threadFloorText = (t: Pick<ThreadRow, 'title' | 'description' | 'status'>): string =>
  lines(`${t.title} (${t.status})`, t.description)

const loreFloorText = (l: Pick<LoreRow, 'title' | 'body'>): string => lines(l.title, l.body)

const floorRowsOf = (floor: StructuralFloor | null): ProbeCapturePayload['structural_floor'] => {
  if (floor === null) return []
  const rows: ProbeCapturePayload['structural_floor'] = []
  const pushEntity = (kind: VecTargetKind, id: string, e: Parameters<typeof entityFloorText>[0]) =>
    rows.push({ target_kind: kind, target_id: id, tokens: countTokens(entityFloorText(e)) })
  const pushThread = (id: string, t: Parameters<typeof threadFloorText>[0]) =>
    rows.push({ target_kind: 'thread', target_id: id, tokens: countTokens(threadFloorText(t)) })
  const pushLore = (id: string, l: Parameters<typeof loreFloorText>[0]) =>
    rows.push({ target_kind: 'lore', target_id: id, tokens: countTokens(loreFloorText(l)) })

  for (const e of floor.sceneEntities) pushEntity('entity', e.id, e)
  if (floor.currentLocation) pushEntity('entity', floor.currentLocation.id, floor.currentLocation)
  for (const t of floor.activeThreads) pushThread(t.id, t)
  for (const e of floor.alwaysEntities) pushEntity('entity', e.id, e)
  for (const l of floor.alwaysLore) pushLore(l.id, l)
  for (const t of floor.alwaysThreads) pushThread(t.id, t)
  return rows
}

export function buildCapturePayload(input: CapturePayloadInput): ProbeCapturePayload {
  const { outcome, mode } = input
  const { queries: stack, floor, bundles } = outcome.ok ? outcome : outcome.partial

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
    // outcome.failure.staleCount (a failure's dirty-row count) is one scalar;
    // there is no per-type split to spread it across, so this stays zero
    // rather than guessing which type(s) it belonged to.
    stale_counts: outcome.ok
      ? { ...outcome.staleCounts }
      : { entities: 0, lore: 0, happenings: 0, threads: 0, chapters: 0 },
  }
}
