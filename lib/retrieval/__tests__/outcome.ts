import type { StructuralFloor } from '../pools'
import type { QueryStack } from '../queries'
import type {
  InjectedAwareness,
  RetrievalFailure,
  RetrievalOutcome,
  RetrievalPartial,
  RetrievalSuccess,
  RetrievalTimings,
} from '../run'
import { RETRIEVAL_TYPES, type Candidate, type RankedType, type RetrievalType } from '../types'

const perType = <T>(value: (type: RetrievalType) => T): Record<RetrievalType, T> =>
  Object.fromEntries(RETRIEVAL_TYPES.map((t) => [t, value(t)])) as Record<RetrievalType, T>

/**
 * A bundle whose funnel agrees with its `selected` list. Ranking is what
 * normally keeps the two consistent, so a fixture pairing zeroed counts with a
 * non-empty list describes a pass the ranker cannot produce.
 */
function rankedBundle(selected: readonly Candidate[]): RankedType {
  return {
    selected,
    traces: [],
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
    queries: over.queries ?? {
      q1: { text: '', source: 'user_action' },
      q2: { text: '', source: 'structural_digest' },
      q3: { text: '', source: 'prose_extract' },
      presence: [false, false, false],
      embedTexts: [],
    },
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
    partial: { queries: null, floor: null, bundles: {}, ...partial },
  }
}
