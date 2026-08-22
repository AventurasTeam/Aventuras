import type { ProbeCapturePayload } from '@/lib/db'
import { rankPerType, type Candidate, type RankedType, type RetrievalType } from '@/lib/retrieval'

import { assertRankerParams, RankerParamsError } from './validate'

type CaptureRow = ProbeCapturePayload['pools'][RetrievalType][number]

const REPLAY_CHAPTER = 'ch_replay'

const entryIdOf = (row: CaptureRow): string => `entry_${row.target_id}`

export type ReplayOptions = {
  /**
   * Prices a row the captured params pre-filtered and the replayed params
   * promoted into the kept set. Such a row stores neither its text nor its
   * cost, so nothing in the capture can price it; the default refuses the run
   * rather than seating it at bare type-overhead.
   */
  countTokens?: (text: string) => number
}

const refusePromotedRow = (): number => {
  throw new Error(
    'replay: the params promoted a row the capture pre-filtered, which stores no text or token cost',
  )
}

/**
 * Re-runs the production ranker over a captured pool. Deep captures only:
 * `mmrRank` takes a pairwise cosine over every kept row, and light mode stores
 * no vectors, so a light capture cannot reach MMR at all.
 */
export function replayType(
  payload: ProbeCapturePayload,
  type: RetrievalType,
  options: ReplayOptions = {},
): RankedType {
  if (payload.capture_mode !== 'deep') {
    throw new Error(`replayType needs a deep capture, got ${payload.capture_mode}`)
  }
  // A failed pass captured whatever it reached, so its pools are truncated at
  // the failure point rather than empty. Re-ranking them returns a selection the
  // pass never made, which reads as a result (probe.md → Failed captures).
  if (payload.failure_reason !== null) {
    throw new Error(`replayType cannot simulate a failed capture (${payload.failure_reason})`)
  }
  // A simulator retunes the snapshot after decodeCapture validated it, so the
  // guard has to run here too, not only at the read boundary.
  assertRankerParams(payload.params.ranker)
  const budget = payload.params.retrievalBudgets[type]
  // Unvalidated anywhere else: a NaN or negative budget drops every row to
  // over_budget with no error, which reads as a ranking result.
  if (!Number.isFinite(budget) || budget < 0) {
    throw new RankerParamsError(
      `retrievalBudgets.${type}`,
      `must be a finite non-negative number, got ${budget}`,
    )
  }
  const rows = payload.pools[type]

  // chapter_boost_applied is captured as a boolean, but score() re-derives it from
  // (occurredAtEntryId ∈ boostedEntryIds). Every row gets a synthetic entry id and
  // only the boosted ones enter the range, so the range alone carries the flag and
  // the capture has to store neither the entry id nor the chapter's span.
  const chapterRanges = new Map([
    [REPLAY_CHAPTER, new Set(rows.filter((r) => r.chapter_boost_applied).map(entryIdOf))],
  ])

  const pool: Candidate[] = rows.map((r) => {
    // Downstream this surfaces as a cosine dimension mismatch naming neither row
    // — and in a pool of one, where MMR takes no pairwise similarity at all, as
    // nothing.
    if (r.vector === undefined || r.vector.length === 0) {
      throw new Error(`capture row ${r.target_id} carries no vector`)
    }
    const base = {
      id: r.target_id,
      displayName: r.display_name,
      // Null only on a pre-filtered row, which the captured params never costed.
      renderedText: r.display_text ?? '',
      sims: [r.sim_q1, r.sim_q2, r.sim_q3] as const,
      vector: Float32Array.from(r.vector),
      chaptersOld: r.chapters_old,
      pinSignal: r.pin_signal,
      // score() reads only `.length > 0`, so a marker reproduces the boost exactly.
      keywordHits: r.kw_boost_value > 0 ? ['·'] : [],
      embeddingStale: r.embedding_stale,
    }
    if (r.target_kind !== 'happening') return { ...base, kind: r.target_kind }
    // Defaulting instead would re-score the row as decaying and pinnable — a
    // divergence no error marks, unlike the missing vector rejected above.
    if (r.common_knowledge === undefined) {
      throw new Error(`capture row ${r.target_id} carries no common_knowledge`)
    }
    return {
      ...base,
      kind: 'happening' as const,
      commonKnowledge: r.common_knowledge,
      occurredAtEntryId: entryIdOf(r),
      awarenessIds: [],
    }
  })

  return rankPerType(pool, type, budget, {
    params: payload.params.ranker,
    chapterRanges,
    matchedChapterIds: new Set([REPLAY_CHAPTER]),
    countTokens: options.countTokens ?? refusePromotedRow,
    capturedTokens: new Map(
      rows.flatMap((r) =>
        r.tokens_estimated === null ? [] : [[r.target_id, r.tokens_estimated] as const],
      ),
    ),
  })
}
