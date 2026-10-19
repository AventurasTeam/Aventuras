import {
  CAPTURE_VERSION,
  type CaptureCandidate,
  type CaptureKeywordInjection,
  type ProbeCapturePayload,
  type VecTargetKind,
} from '@/lib/db'
import {
  buildQueryStack,
  countTokens,
  entityHead,
  entityStateLines,
  itemLine,
  lines,
  TOKENIZER_IDENTITY,
  type CandidateTrace,
  type EntityRow,
  type KeywordInjection,
  type LoreRow,
  type QueryRedundancy,
  type QuerySpec,
  type QueryStack,
  type RankedType,
  type RankerParams,
  type RetrievalOutcome,
  type RetrievalType,
  type StructuralFloor,
  type StateLineOptions,
  type ThreadRow,
} from '@/lib/retrieval'
import type { EntityViews } from '@/lib/world'

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
  /** The scan surface the pass ran with (retrieval.md → Keyword scan surface). */
  scanText: string
  outcome: RetrievalOutcome
  /** The views the pass seated the floor from, for the floor rows' state lines. */
  entityViews: EntityViews
}

const candidateOf = (
  t: CandidateTrace,
  mode: 'light' | 'deep',
  vector: Float32Array | undefined,
): CaptureCandidate => ({
  target_kind: t.kind,
  target_id: t.id,
  display_name: t.displayName,
  display_text: t.renderedText,
  sims: [...t.sims],
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

const injectionOf = (i: KeywordInjection): CaptureKeywordInjection => ({
  target_kind: i.row.kind,
  target_id: i.row.id,
  display_name: i.row.displayName,
  terms: [...i.terms],
  tokens_estimated: i.tokensEstimated,
  seated: i.seated,
  priority: i.priority,
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

const queryOf = (q: QuerySpec, redundancy: QueryRedundancy | null) => ({
  text: q.text,
  token_count: countTokens(q.text),
  source: q.source,
  redundancy: redundancy?.ratio ?? null,
  redundancy_k: redundancy?.k ?? null,
})

// A pass that failed before building a stack still captures the fixed slots, so
// the probe renders them absent rather than showing no queries at all.
const ABSENT_QUERY_STACK = buildQueryStack({
  userAction: '',
  sceneEntityNames: [],
  currentLocationName: null,
  activeThreadTitles: [],
  eraName: null,
  piggybackSummary: null,
})

// No query vector in either mode: λ_div — the one thing deep mode exists for —
// needs candidate-vs-candidate cosines, and every other simulation re-blends
// the per-row `sims` (probe.md → Deep mode).
//
// `redundancy` is indexed defensively: a partial with no stack of its own carries
// an empty array beside ABSENT_QUERY_STACK's three specs.
const queriesOf = (
  stack: QueryStack | null,
  redundancy: readonly (QueryRedundancy | null)[],
): ProbeCapturePayload['queries'] =>
  (stack ?? ABSENT_QUERY_STACK).specs.map((q, i) => queryOf(q, redundancy[i] ?? null))

const nameWithDescription = (name: string, description: string | null): string =>
  description ? `${name}: ${description}` : name

// The floor's rows priced as the bundled templates render them (probe.md → Structural floor):
// per-turn.ts's scene and location sections, its Holds and Here lines, and memory-blocks.ts's
// rows for a scene's faction, a pinned row and the threads and lore. Every entity row leaves out
// the `[id]` affixes the templates add when piggybackFires, which is decided after retrieval and
// so unknowable here, and `# Current location` its chain, which isn't on the floor: on those
// turns the floor cost reads as a lower bound. A held or loose item is its own row, its line
// priced there and its holder's row or the location's carrying only the Holds or Here label, so
// the template's one rendering is counted once.
const NO_IDS = { heldId: null } as const satisfies Partial<StateLineOptions>

const stateLinesOf = (
  e: Pick<EntityRow, 'id' | 'kind'>,
  views: EntityViews,
  options: StateLineOptions,
): string[] => entityStateLines(views.kinded(e.id, e.kind), options)

const sceneEntityText = (
  e: Pick<EntityRow, 'id' | 'kind' | 'name' | 'description'>,
  views: EntityViews,
) =>
  lines(
    `## ${e.name}`,
    e.description?.trim() ? e.description : null,
    ...stateLinesOf(e, views, { ...NO_IDS, here: true, heldLines: false }),
  )

const currentLocationText = (
  e: Pick<EntityRow, 'id' | 'kind' | 'name' | 'description'>,
  views: EntityViews,
) =>
  [
    nameWithDescription(e.name, e.description),
    ...stateLinesOf(e, views, { ...NO_IDS, here: true }),
    ...(views.looseAt(e.id).length > 0 ? ['Here:'] : []),
  ].join('\n')

// A pinned row and a scene's faction share memory-blocks.ts's one row shape.
const memoryRowText = (
  e: Pick<EntityRow, 'id' | 'kind' | 'name' | 'description' | 'status'>,
  views: EntityViews,
) => [entityHead(e), ...stateLinesOf(e, views, { ...NO_IDS, here: false })].join('\n')

const activeThreadText = (t: Pick<ThreadRow, 'title' | 'description'>): string =>
  lines(t.title, t.description)

const alwaysThreadText = (t: Pick<ThreadRow, 'title' | 'description' | 'status'>): string =>
  lines(`${t.title} (${t.status})`, t.description)

const alwaysLoreText = (l: Pick<LoreRow, 'title' | 'body'>): string => lines(l.title, l.body)

const floorRowsOf = (
  floor: StructuralFloor | null,
  views: EntityViews,
): ProbeCapturePayload['structural_floor'] => {
  if (floor === null) return []
  const rows: ProbeCapturePayload['structural_floor'] = []
  const push = (kind: VecTargetKind, id: string, text: string) =>
    rows.push({ target_kind: kind, target_id: id, tokens: countTokens(text) })

  const inScene = new Set(floor.sceneEntities.map((e) => e.id))
  const heldLine = (itemId: string): string | null => {
    const holderId = views.of(itemId, 'item').holder?.id
    if (holderId === undefined || !inScene.has(holderId)) return null
    const held = views.of(holderId, 'character').holdings.find((h) => h.id === itemId)
    return held === undefined ? null : itemLine(held, null)
  }
  const looseLine = (e: Pick<EntityRow, 'id' | 'name' | 'description'>): string =>
    itemLine(
      { name: e.name, description: e.description, condition: views.of(e.id, 'item').condition },
      null,
    )
  const here = floor.currentLocation?.id
  const liesHere = (id: string): boolean =>
    here !== undefined && views.of(id, 'item').location?.id === here

  // An in-scene item a holder in the scene holds, or one lying here, renders as that one line.
  for (const e of floor.sceneEntities) {
    const held = e.kind === 'item' ? heldLine(e.id) : null
    if (held !== null) push('entity', e.id, held)
    else if (e.kind === 'item' && liesHere(e.id)) push('entity', e.id, looseLine(e))
    else push('entity', e.id, sceneEntityText(e, views))
  }
  if (floor.currentLocation) {
    push('entity', floor.currentLocation.id, currentLocationText(floor.currentLocation, views))
  }
  for (const e of floor.sceneFactions) push('entity', e.id, memoryRowText(e, views))
  for (const e of floor.heldItems) push('entity', e.id, heldLine(e.id) ?? looseLine(e))
  for (const e of floor.looseItems) push('entity', e.id, looseLine(e))
  for (const t of floor.activeThreads) push('thread', t.id, activeThreadText(t))
  for (const e of floor.alwaysEntities) push('entity', e.id, memoryRowText(e, views))
  for (const l of floor.alwaysLore) push('lore', l.id, alwaysLoreText(l))
  for (const t of floor.alwaysThreads) push('thread', t.id, alwaysThreadText(t))
  return rows
}

export function buildCapturePayload(input: CapturePayloadInput): ProbeCapturePayload {
  const { outcome, mode } = input
  const {
    queries: stack,
    floor,
    bundles,
    keywordInjections,
    queryRedundancy,
  } = outcome.ok ? outcome : outcome.partial

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
    queries: queriesOf(stack, queryRedundancy),
    scan_text: input.scanText,
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
    structural_floor: floorRowsOf(floor, input.entityViews),
    keyword_injections: keywordInjections.map(injectionOf),
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
