import type { ProbeCapturePayload } from '@/lib/db'
import { rankPerType, type Candidate, type RankedType, type RetrievalType } from '@/lib/retrieval'

type CaptureRow = ProbeCapturePayload['pools'][RetrievalType][number]

const REPLAY_CHAPTER = 'ch_replay'

const entryIdOf = (row: CaptureRow): string => `entry_${row.target_id}`

/**
 * Re-runs the production ranker over a captured pool. Deep captures only:
 * `mmrRank` takes a pairwise cosine over every kept row, and light mode stores
 * no vectors, so a light capture cannot reach MMR at all.
 */
export function replayType(payload: ProbeCapturePayload, type: RetrievalType): RankedType {
  if (payload.capture_mode !== 'deep') {
    throw new Error(`replayType needs a deep capture, got ${payload.capture_mode}`)
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
    const base = {
      id: r.target_id,
      displayName: r.display_name,
      // Null only on a pre-filtered row, which is never costed and never seated.
      renderedText: r.display_text ?? '',
      sims: [r.sim_q1, r.sim_q2, r.sim_q3] as const,
      vector: Float32Array.from(r.vector ?? []),
      chaptersOld: r.chapters_old,
      pinSignal: r.pin_signal,
      // score() reads only `.length > 0`, so a marker reproduces the boost exactly.
      keywordHits: r.kw_boost_value > 0 ? ['·'] : [],
      embeddingStale: r.embedding_stale,
    }
    if (r.target_kind !== 'happening') return { ...base, kind: r.target_kind }
    // Defaulting instead would re-score the row as decaying and pinnable, the one
    // absent field that diverges silently rather than failing the way a missing
    // vector does.
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

  return rankPerType(pool, type, payload.params.retrievalBudgets[type], {
    params: payload.params.ranker,
    chapterRanges,
    matchedChapterIds: new Set([REPLAY_CHAPTER]),
    // Reaching the tokenizer would mean the capture did not carry what
    // budget-fill needed, which is exactly what the parity test is claiming.
    countTokens: () => {
      throw new Error('replay reached the tokenizer; the capture was insufficient')
    },
    capturedTokens: new Map(
      rows.flatMap((r) =>
        r.tokens_estimated === null ? [] : [[r.target_id, r.tokens_estimated] as const],
      ),
    ),
  })
}
