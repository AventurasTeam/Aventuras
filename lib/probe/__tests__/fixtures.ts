import { buildQueryStack, countTokens, rankPerType, RANKER_DEFAULTS } from '@/lib/retrieval'
import { retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'

// Every scored field distinct: a same-valued pair (0, false, 0.605 == 0.605)
// would let a transposed field mapping in candidateOf pass toEqual anyway.
export const loreCandidate = {
  kind: 'lore' as const,
  id: 'lo_1',
  displayName: 'The drowned archive',
  renderedText: 'Ledgers are kept below the waterline, where the tide reads them first.',
  sims: [0.95, 0.9, 0.85] as const,
  vector: Float32Array.from([1, 0]),
  chaptersOld: 3,
  pinSignal: 0.4,
  keywordHits: ['tide'],
  embeddingStale: true,
}

// Priced with the real tokenizer, not a stand-in: a captured payload stamps
// tokenizer: o200k_base, so a fixture priced any other way would make the
// capture internally inconsistent with its own declared vocabulary.
export const loreBundle = () =>
  rankPerType([loreCandidate], 'lore', 10_000, {
    params: RANKER_DEFAULTS,
    chapterRanges: new Map(),
    countTokens,
  })

export const queryStack = () =>
  buildQueryStack({
    userAction: 'Mira opens the ledger and reads the tide marks aloud.',
    sceneEntityNames: ['Mira'],
    currentLocationName: 'The drowned archive',
    activeThreadTitles: [],
    eraName: null,
    piggybackSummary: null,
    lastNarrativeContent: 'A courier arrived at dusk carrying nothing but an empty seal case.',
    index: { entityNames: new Set(['mira']), loreKeywords: new Set() },
  })

export const successOutcome = () =>
  retrievalSuccess({ bundles: { lore: loreBundle() }, queries: queryStack() })
