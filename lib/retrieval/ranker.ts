import { mmrRank } from './mmr'
import type {
  Candidate,
  CandidateTrace,
  DropReason,
  QueryPresence,
  QueryWeights,
  RankAllInput,
  RankedType,
  RankerParams,
  RetrievalType,
} from './types'

export type RankTypeInput = {
  params: RankerParams
  presence: QueryPresence
  chapterRanges: ReadonlyMap<string, ReadonlySet<string>>
  countTokens: (text: string) => number
  /** Chapters that won budget this turn; only they feed the happenings boost. */
  matchedChapterIds?: ReadonlySet<string>
}

type Scored = {
  id: string
  score: number
  vector: Float32Array
  candidate: Candidate
  simBlend: number
  recencyFactor: number
  pinSignal: number
  kwBoostValue: number
  chapterBoostApplied: boolean
  bypassTriggered: boolean
  tokensEstimated: number
}

function blendSims(
  sims: readonly [number, number, number],
  weights: QueryWeights,
  presence: QueryPresence,
): number {
  const w = [weights.action, weights.digest, weights.prose]
  let weighted = 0
  let total = 0
  for (let i = 0; i < 3; i++) {
    if (!presence[i]) continue
    weighted += w[i] * sims[i]
    total += w[i]
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
  const simBlend = blendSims(c.sims, params.weights, input.presence)
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
    kwBoostValue,
    chapterBoostApplied,
    bypassTriggered,
    // Costed for every pool row, not just the ones that reach budget fill: the
    // probe simulator re-runs budget-fill against stored tokens_estimated with
    // the user's own thresholds (probe.md → Simulatable parameters).
    tokensEstimated: input.countTokens(c.renderedText) + params.typeOverhead[type],
  }
}

function trace(s: Scored, mmrRankIndex: number | null, dropReason: DropReason): CandidateTrace {
  return {
    kind: s.candidate.kind,
    id: s.id,
    displayName: s.candidate.displayName,
    simQ1: s.candidate.sims[0],
    simQ2: s.candidate.sims[1],
    simQ3: s.candidate.sims[2],
    simBlend: s.simBlend,
    recencyFactor: s.recencyFactor,
    pinSignal: s.pinSignal,
    kwBoostValue: s.kwBoostValue,
    chapterBoostApplied: s.chapterBoostApplied,
    bypassTriggered: s.bypassTriggered,
    finalScore: s.score,
    mmrRank: mmrRankIndex,
    selected: dropReason === 'not_dropped',
    dropReason,
    tokensEstimated: s.tokensEstimated,
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

export function rankPerType(
  pool: readonly Candidate[],
  type: RetrievalType,
  budget: number,
  input: RankTypeInput,
): RankedType {
  const boostedEntryIds = boostedEntryIdsFor(input)
  const scored = pool.map((c) => score(c, type, input, boostedEntryIds))
  scored.sort((a, b) => b.score - a.score)

  const kept = scored.slice(0, input.params.preFilterTopN)
  const ranked = mmrRank(kept, input.params.lambdaDiv)

  const selected: Candidate[] = []
  const traces: CandidateTrace[] = []
  let remaining = budget
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
    traces.push(trace(r, i, dropReason))
  }

  for (const s of scored.slice(input.params.preFilterTopN)) {
    traces.push(trace(s, null, 'pre_filtered'))
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
  }
}

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
    input,
  ),
): Record<RetrievalType, RankedType> {
  const happenings = rankPerType(input.pools.happenings, 'happenings', input.budgets.happenings, {
    ...input,
    matchedChapterIds: new Set(chapters.selected.map((c) => c.id)),
  })

  return {
    entities: rankPerType(input.pools.entities, 'entities', input.budgets.entities, input),
    lore: rankPerType(input.pools.lore, 'lore', input.budgets.lore, input),
    threads: rankPerType(input.pools.threads, 'threads', input.budgets.threads, input),
    happenings,
    chapters,
  }
}
