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
  /** Priced on the composed buffer, not re-derived: the mode-dependent rule and
   * protected-buffer spillover are the phase's to resolve, not the capture's. */
  promptBufferTokens: number
  outcome: RetrievalOutcome
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
  mmr_score: t.mmrScore,
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
  const traceById = new Map(bundle.traces.map((trace) => [trace.id, trace]))
  return bundle.pool.map((candidate) => {
    const trace = traceById.get(candidate.id)
    if (trace === undefined) throw new Error(`ranked candidate ${candidate.id} has no trace`)
    return candidateOf(trace, mode, candidate.vector)
  })
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

const queryOf = (q: QuerySpec) => ({
  text: q.text,
  token_count: countTokens(q.text),
  source: q.source,
  ...(q.sentenceScores ? { sentence_scores: [...q.sentenceScores] } : {}),
})

// No query vector in either mode: λ_div — the one thing deep mode exists for —
// needs candidate-vs-candidate cosines, and every other simulation re-blends
// the per-row sim_q1..3 (probe.md → Deep mode).
const queriesOf = (stack: QueryStack | null): ProbeCapturePayload['queries'] => {
  if (stack === null) {
    return [
      queryOf({ text: '', source: 'user_action' }),
      queryOf({ text: '', source: 'structural_digest' }),
      queryOf({ text: '', source: 'prose_extract' }),
    ]
  }
  return [queryOf(stack.q1), queryOf(stack.q2), queryOf(stack.q3)]
}

// run.ts's lines() isn't exported from lib/retrieval; reimplemented here so a
// blank field doesn't leave its join separator behind.
const lines = (...parts: (string | null)[]): string =>
  parts.filter((p) => p !== null && p !== '').join('\n')

const nameWithDescription = (name: string, description: string | null): string =>
  description ? `${name}: ${description}` : name

// Six floor branches render through two template families and none of them
// share a formula. per-turn.ts's in-scene/current-location rows and
// memory-blocks.ts's active-threads row carry no framing or status — a
// floor-seated row is present, so it never reads as "elsewhere" or
// "introducible" the way a pooled row can. Only the memory-blocks.ts "always"
// rows (structuralPinnedEntities/Lore/Threads) reuse the ranker's own
// entity/lore/thread projections, ENTITY_FRAMING included.
// The three entity branches omit the `[id]` affix the templates add when
// piggybackFires, which is decided after retrieval and so unknowable here —
// the floor cost is a lower bound on those turns (probe.md → Structural floor).
const sceneEntityText = (e: Pick<EntityRow, 'name' | 'description'>): string =>
  lines(`## ${e.name}`, e.description)

const currentLocationText = (e: Pick<EntityRow, 'name' | 'description'>): string =>
  nameWithDescription(e.name, e.description)

const activeThreadText = (t: Pick<ThreadRow, 'title' | 'description'>): string =>
  lines(t.title, t.description)

const alwaysEntityText = (e: Pick<EntityRow, 'name' | 'description' | 'status'>): string => {
  const framing = ENTITY_FRAMING[e.status]
  const head = framing === undefined ? e.name : `${e.name} (${framing})`
  return nameWithDescription(head, e.description)
}

const alwaysThreadText = (t: Pick<ThreadRow, 'title' | 'description' | 'status'>): string =>
  lines(`${t.title} (${t.status})`, t.description)

const alwaysLoreText = (l: Pick<LoreRow, 'title' | 'body'>): string => lines(l.title, l.body)

const floorRowsOf = (floor: StructuralFloor | null): ProbeCapturePayload['structural_floor'] => {
  if (floor === null) return []
  const rows: ProbeCapturePayload['structural_floor'] = []
  const push = (kind: VecTargetKind, id: string, text: string) =>
    rows.push({ target_kind: kind, target_id: id, tokens: countTokens(text) })

  for (const e of floor.sceneEntities) push('entity', e.id, sceneEntityText(e))
  if (floor.currentLocation) {
    push('entity', floor.currentLocation.id, currentLocationText(floor.currentLocation))
  }
  for (const t of floor.activeThreads) push('thread', t.id, activeThreadText(t))
  for (const e of floor.alwaysEntities) push('entity', e.id, alwaysEntityText(e))
  for (const l of floor.alwaysLore) push('lore', l.id, alwaysLoreText(l))
  for (const t of floor.alwaysThreads) push('thread', t.id, alwaysThreadText(t))
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
    queries: queriesOf(stack),
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
    prompt_buffer_tokens: input.promptBufferTokens,
    // outcome.failure.staleCount (a failure's dirty-row count) is one scalar;
    // there is no per-type split to spread it across, so this stays zero
    // rather than guessing which type(s) it belonged to.
    stale_counts: outcome.ok
      ? { ...outcome.staleCounts }
      : { entities: 0, lore: 0, happenings: 0, threads: 0, chapters: 0 },
    // Null for a cancel as for a success: failure_reason records a FAULT and a user
    // stop is not one. Unreachable today; it is why cancelled is not an EmbedderErrorKind.
    failure_reason: outcome.ok || outcome.cancelled ? null : outcome.failure.reason,
  }
}
