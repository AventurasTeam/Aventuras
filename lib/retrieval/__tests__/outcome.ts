import type { StructuralFloor } from '../pools'
import { buildQueryStack, type QueryStack } from '../queries'
import type {
  InjectedAwareness,
  RetrievalFailure,
  RetrievalOutcome,
  RetrievalPartial,
  RetrievalSuccess,
  RetrievalTimings,
} from '../run'
import {
  RETRIEVAL_TYPES,
  type Candidate,
  type CandidateTrace,
  type KeywordInjection,
  type RankedType,
  type RetrievalType,
} from '../types'

const perType = <T>(value: (type: RetrievalType) => T): Record<RetrievalType, T> =>
  Object.fromEntries(RETRIEVAL_TYPES.map((t) => [t, value(t)])) as Record<RetrievalType, T>

// A hand-shaped stack can describe slots no pass emits.
const emptyQueryStack = (): QueryStack =>
  buildQueryStack({
    userAction: '',
    sceneEntityNames: [],
    currentLocationName: null,
    activeThreadTitles: [],
    eraName: null,
    piggybackSummary: null,
  })

// A seated row's trace, carrying only what the candidate already fixes; the
// scoring fields are placeholders, the one-per-pool-row pairing is not — a pool
// row without a trace is a bundle the ranker cannot produce, and lib/probe's
// capture builder refuses it outright.
const traceOf = (c: Candidate, mmrRank: number): CandidateTrace => ({
  kind: c.kind,
  id: c.id,
  displayName: c.displayName,
  sims: c.sims,
  simBlend: 0,
  recencyFactor: 1,
  pinSignal: c.pinSignal,
  chaptersOld: c.chaptersOld,
  renderedText: c.renderedText,
  ...(c.kind === 'happening' ? { commonKnowledge: c.commonKnowledge } : {}),
  kwBoostValue: 0,
  chapterBoostApplied: false,
  bypassTriggered: false,
  finalScore: 0,
  mmrScore: 0,
  mmrRank,
  selected: true,
  dropReason: 'not_dropped',
  tokensEstimated: 0,
  embeddingStale: c.embeddingStale,
})

/**
 * A bundle whose funnel and traces agree with its `selected` list. Ranking is
 * what normally keeps the three consistent, so a fixture pairing zeroed counts
 * with a non-empty list describes a pass the ranker cannot produce.
 */
function rankedBundle(selected: readonly Candidate[]): RankedType {
  return {
    selected,
    traces: selected.map(traceOf),
    funnel: {
      poolSize: selected.length,
      preFilteredSize: selected.length,
      selectedCount: selected.length,
      tokensUsed: 0,
      typeBudget: 0,
    },
    pool: selected,
  }
}

export type RetrievalSuccessOverrides = {
  floor?: Partial<StructuralFloor>
  /** Per-type selected rows; each becomes a bundle with a matching funnel. */
  selected?: Partial<Record<RetrievalType, readonly Candidate[]>>
  /** Whole-bundle replacement, for traces or a funnel that must not be derived. */
  bundles?: Partial<Record<RetrievalType, RankedType>>
  queries?: QueryStack
  keywordInjections?: readonly KeywordInjection[]
  staleCounts?: Partial<Record<RetrievalType, number>>
  injectedAwareness?: InjectedAwareness[]
  selectedLocationIds?: string[]
  timings?: RetrievalTimings
}

/**
 * A complete `RetrievalSuccess`, typed rather than cast: consumers project a
 * dozen template variables off this shape, so a fabricated one would render a
 * prompt no production pass can produce. Every call returns fresh objects — a
 * shared empty bundle is one `.push` away from leaking across tests.
 */
export function retrievalSuccess(over: RetrievalSuccessOverrides = {}): RetrievalSuccess {
  return {
    ok: true,
    floor: {
      sceneEntities: [],
      currentLocation: null,
      activeThreads: [],
      alwaysEntities: [],
      alwaysLore: [],
      alwaysThreads: [],
      seatedIds: new Set(),
      ...over.floor,
    },
    bundles: perType((type) => over.bundles?.[type] ?? rankedBundle(over.selected?.[type] ?? [])),
    queries: over.queries ?? emptyQueryStack(),
    keywordInjections: over.keywordInjections ?? [],
    staleCounts: { ...perType(() => 0), ...over.staleCounts },
    injectedAwareness: over.injectedAwareness ?? [],
    selectedLocationIds: over.selectedLocationIds ?? [],
    timings: over.timings ?? { totalMs: 0, syncMs: 0, embedMs: 0, knnMs: 0, rankMs: 0 },
  }
}

/**
 * The `ok: false` counterpart to `retrievalSuccess`. `partial` defaults to the
 * all-null shape a sync-stage failure carries — the most restrictive real case
 * — so a fixture that only cares about `failure` doesn't have to fabricate one.
 */
export function retrievalFailure(
  failure: RetrievalFailure,
  partial: Partial<RetrievalPartial> = {},
): Extract<RetrievalOutcome, { ok: false }> {
  return {
    ok: false,
    failure,
    partial: { queries: null, floor: null, bundles: {}, keywordInjections: [], ...partial },
  }
}
