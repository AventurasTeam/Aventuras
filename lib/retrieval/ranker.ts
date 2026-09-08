import { mmrRank } from './mmr'
import type {
  Candidate,
  CandidateTrace,
  DropReason,
  KeywordInjection,
  QuerySlot,
  QueryWeights,
  RankAllInput,
  RankedType,
  RankerParams,
  RetrievalType,
  SeatedRow,
} from './types'

export type RankTypeInput = {
  params: RankerParams
  /** Must be the same order every candidate's `sims` was computed in; length is enforced. */
  querySlots: readonly QuerySlot[]
  chapterRanges: ReadonlyMap<string, ReadonlySet<string>>
  countTokens: (text: string) => number
  /** Chapters that won budget this turn; only they feed the happenings boost. */
  matchedChapterIds?: ReadonlySet<string>
  /**
   * Token counts from a probe capture, keyed by candidate id. A replay passes
   * them so the seated set does not depend on the tokenizer version loaded at
   * replay time; production omits it and the count is computed. Each value is
   * the stored total, tokenizer count plus the type overhead. A kept id absent
   * from the map falls back to computing it.
   */
  capturedTokens?: ReadonlyMap<string, number>
  /**
   * This type's keyword matches (retrieval.md → Keyword injection budget). Empty
   * under `mode='boost'`; cut rows are ignored here and compete on score instead.
   */
  keywordInjected?: readonly KeywordInjection[]
}

type Scored = {
  id: string
  score: number
  vector: Float32Array
  candidate: Candidate
  simBlend: number
  recencyFactor: number
  pinSignal: number
  chaptersOld: number
  kwBoostValue: number
  chapterBoostApplied: boolean
  bypassTriggered: boolean
}

// Q4 sims are averaged into one pooled share: per-query weighting would make
// emission volume influence (retrieval.md → Blending).
export function blendSims(
  sims: readonly (number | null)[],
  slots: readonly QuerySlot[],
  weights: QueryWeights,
): number {
  const direct: number[] = []
  let weighted = 0
  let total = 0
  for (let i = 0; i < slots.length; i++) {
    const s = sims[i]
    if (s === null) continue
    if (slots[i] === 'direct') {
      direct.push(s)
      continue
    }
    weighted += weights[slots[i]] * s
    total += weights[slots[i]]
  }
  if (direct.length > 0) {
    weighted += weights.direct * (direct.reduce((a, b) => a + b, 0) / direct.length)
    total += weights.direct
  }
  // Renormalizing over the present queries keeps an absent one from dragging
  // every candidate uniformly toward the noise floor.
  return total === 0 ? 0 : weighted / total
}

function score(
  c: Candidate,
  type: RetrievalType,
  input: RankTypeInput,
  boostedEntryIds: ReadonlySet<string>,
): Scored {
  const { params } = input
  const simBlend = blendSims(c.sims, input.querySlots, params.weights)
  const kwBoostValue = c.keywordHits.length > 0 ? params.kwBoost : 0
  const common = c.kind === 'happening' && c.commonKnowledge
  const lambda = params.lambda[type]

  // No awareness row backs these, so pin and decay are inapplicable; 0/1 is the
  // captured shape (probe.md → Common-knowledge happenings).
  const pinSignal = common ? 0 : Math.min(1, Math.max(0, c.pinSignal))
  // Out of range either input flips the exponent's sign, turning decay into
  // growth; pin_signal arrives unvalidated from the probe's per-row override.
  const chaptersOld = Math.max(0, c.chaptersOld)
  const recencyFactor =
    common || lambda <= 0 ? 1 : Math.exp(-lambda * chaptersOld * (1 - pinSignal))

  // A pin reaches the score through the decay exponent, which needs decay to
  // resist — so on a type with lambda = 0 it has no channel at all. pinBoost is
  // that channel, and it is per-type rather than derived from lambda so a
  // reader sees which types use which path. Multiplicative on purpose: it lifts
  // a relevant row above its peers without lifting an irrelevant one over the
  // score threshold, which is what injection_mode='always' is for.
  const pinBoost = 1 + params.pinBoost[type] * pinSignal

  let finalScore = simBlend * recencyFactor * pinBoost + kwBoostValue

  const bypassTriggered = simBlend >= params.tauRevive
  if (bypassTriggered) finalScore = Math.max(finalScore, simBlend - params.tauRevive)

  const chapterBoostApplied =
    c.kind === 'happening' &&
    c.occurredAtEntryId !== null &&
    boostedEntryIds.has(c.occurredAtEntryId)
  if (chapterBoostApplied) finalScore *= params.chapterBoost

  return {
    id: c.id,
    score: finalScore,
    vector: c.vector,
    candidate: c,
    simBlend,
    recencyFactor,
    pinSignal,
    chaptersOld,
    kwBoostValue,
    chapterBoostApplied,
    bypassTriggered,
  }
}

type Costed = Scored & { tokensEstimated: number }

/**
 * retrieval.md → Token estimation. Exported so the keyword pre-pass prices a
 * seat identically — else the probe's reported budget isn't the budget spent.
 */
export function tokenCost(
  text: string,
  type: RetrievalType,
  input: Pick<RankTypeInput, 'params' | 'countTokens'>,
): number {
  return input.countTokens(text) + input.params.typeOverhead[type]
}

// Deferred past the pre-filter: a pre-filtered row can never be seated, so its
// count is never read (retrieval.md → Token estimation).
function costTokens(s: Scored, type: RetrievalType, input: RankTypeInput): Costed {
  const captured = input.capturedTokens?.get(s.id)
  return { ...s, tokensEstimated: captured ?? tokenCost(s.candidate.renderedText, type, input) }
}

function trace(
  s: Scored,
  // One parameter, not two: rank and score are null together or set together, and adjacent
  // same-typed nullables transpose silently.
  mmr: { rank: number; score: number } | null,
  dropReason: DropReason,
  tokensEstimated: number | null,
): CandidateTrace {
  return {
    kind: s.candidate.kind,
    id: s.id,
    displayName: s.candidate.displayName,
    sims: s.candidate.sims,
    simBlend: s.simBlend,
    recencyFactor: s.recencyFactor,
    pinSignal: s.pinSignal,
    chaptersOld: s.chaptersOld,
    renderedText: dropReason === 'pre_filtered' ? null : s.candidate.renderedText,
    ...(s.candidate.kind === 'happening' ? { commonKnowledge: s.candidate.commonKnowledge } : {}),
    kwBoostValue: s.kwBoostValue,
    chapterBoostApplied: s.chapterBoostApplied,
    bypassTriggered: s.bypassTriggered,
    finalScore: s.score,
    mmrScore: mmr?.score ?? null,
    mmrRank: mmr?.rank ?? null,
    selected: dropReason === 'not_dropped',
    dropReason,
    tokensEstimated,
    embeddingStale: s.candidate.embeddingStale,
  }
}

function boostedEntryIdsFor(input: RankTypeInput): ReadonlySet<string> {
  const out = new Set<string>()
  if (input.matchedChapterIds === undefined) return out
  for (const chapterId of input.matchedChapterIds) {
    const range = input.chapterRanges.get(chapterId)
    if (range === undefined) continue
    for (const entryId of range) out.add(entryId)
  }
  return out
}

// Checked here rather than inside blendSims, which runs per candidate. A short
// `sims` scores NaN, but a long one silently drops a query's share and reads as a
// plausible score instead.
function assertSimsAligned(pool: readonly Candidate[], slots: readonly QuerySlot[]): void {
  for (const c of pool) {
    if (c.sims.length !== slots.length) {
      throw new Error(
        `rankPerType: candidate ${c.id} carries ${c.sims.length} sims for ${slots.length} query slots`,
      )
    }
  }
}

export function rankPerType(
  wholePool: readonly Candidate[],
  type: RetrievalType,
  budget: number,
  input: RankTypeInput,
): RankedType {
  const seats = (input.keywordInjected ?? []).filter((i) => i.seated)
  const seatedIds = new Set(seats.map((i) => i.row.id))
  // Seated rows leave the pool (retrieval.md → Keyword injection): never charged
  // twice, and filed as injections with no candidate record. CUT rows stay in.
  const pool = seatedIds.size === 0 ? wholePool : wholePool.filter((c) => !seatedIds.has(c.id))
  assertSimsAligned(pool, input.querySlots)

  const boostedEntryIds = boostedEntryIdsFor(input)
  const scored = pool.map((c) => score(c, type, input, boostedEntryIds))
  scored.sort((a, b) => b.score - a.score)

  const kept = scored.slice(0, input.params.preFilterTopN).map((s) => costTokens(s, type, input))
  const ranked = mmrRank(kept, input.params.lambdaDiv)

  const selected: SeatedRow[] = seats.map((i) => i.row)
  const traces: CandidateTrace[] = []
  // Unclamped: budgetShare caps seats at budget, so a negative means a caller
  // broke the cap — rows are then refused and tokensUsed reports over budget.
  let remaining = budget - seats.reduce((sum, i) => sum + i.tokensEstimated, 0)
  let belowFloor = false

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    // Canon breaks here; the flag instead keeps walking to emit a trace per row.
    // No longer merely equivalent — a bypassed row below the floor is seatable,
    // so the walk has to continue past it rather than stopping.
    if (r.mmrScore < input.params.minScoreThreshold) belowFloor = true

    let dropReason: DropReason = 'not_dropped'
    // retrieval.md → High-similarity bypass: the exemption IS the mechanism.
    // bypassScore is capped at 1 - tauRevive = 0.15, under the 0.2 first-pick
    // floor (minScoreThreshold / lambdaDiv), so raising the score alone revives
    // nothing at any similarity. Budget limits below still bind.
    if (belowFloor && !r.bypassTriggered) {
      dropReason = 'below_threshold'
    } else if (r.tokensEstimated > budget) {
      dropReason = 'candidate_too_large'
    } else if (r.tokensEstimated > remaining) {
      dropReason = 'over_budget'
    } else {
      selected.push(r.candidate)
      remaining -= r.tokensEstimated
    }
    traces.push(trace(r, { rank: i, score: r.mmrScore }, dropReason, r.tokensEstimated))
  }

  for (const s of scored.slice(input.params.preFilterTopN)) {
    traces.push(trace(s, null, 'pre_filtered', null))
  }

  return {
    selected,
    traces,
    funnel: {
      poolSize: pool.length,
      preFilteredSize: kept.length,
      selectedCount: selected.length,
      tokensUsed: budget - remaining,
      typeBudget: budget,
    },
    pool,
  }
}

/**
 * Module-level so the `chapters` default parameter can reach it. Mirrors canon's
 * `injected_by_type.get(type, ())` — chapters and happenings stay on `boost`.
 */
const forType = (input: RankAllInput, type: RetrievalType): RankTypeInput => ({
  ...input,
  keywordInjected: input.keywordInjected?.[type] ?? [],
})

/**
 * Chapters rank first, because only the chapters that win budget feed the
 * happenings boost. `runRetrieval` needs that set *before* it can build the
 * happenings pool — chapter membership decides admission, not just score — so
 * it ranks chapters itself and hands the bundle back rather than paying for the
 * pass twice. A caller with no such need omits it and gets the same ordering.
 */
export function rankAll(
  input: RankAllInput,
  chapters: RankedType = rankPerType(
    input.pools.chapters,
    'chapters',
    input.budgets.chapters,
    forType(input, 'chapters'),
  ),
): Record<RetrievalType, RankedType> {
  const happenings = rankPerType(input.pools.happenings, 'happenings', input.budgets.happenings, {
    ...forType(input, 'happenings'),
    matchedChapterIds: new Set(chapters.selected.map((c) => c.id)),
  })

  return {
    entities: rankPerType(
      input.pools.entities,
      'entities',
      input.budgets.entities,
      forType(input, 'entities'),
    ),
    lore: rankPerType(input.pools.lore, 'lore', input.budgets.lore, forType(input, 'lore')),
    threads: rankPerType(
      input.pools.threads,
      'threads',
      input.budgets.threads,
      forType(input, 'threads'),
    ),
    happenings,
    chapters,
  }
}
