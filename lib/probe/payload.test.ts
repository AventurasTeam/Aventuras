import { describe, expect, it } from 'vitest'

import { buildQueryStack, rankPerType, RANKER_DEFAULTS } from '@/lib/retrieval'
import { retrievalFailure, retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'

import { buildCapturePayload } from './payload'

const settings = {
  retrievalBudgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
  fullChapterInBuffer: false,
  partialChapterBuffer: 2,
  protectedBuffer: 1,
}

const identity = {
  branchId: 'br_1',
  targetEntryId: 'ent_1',
  chapterId: null,
  capturedAt: 1_700_000_000_000,
  embeddingModelId: 'Xenova/all-MiniLM-L6-v2',
}

const loreCandidate = {
  kind: 'lore' as const,
  id: 'lo_1',
  displayName: 'The drowned archive',
  renderedText: 'Ledgers are kept below the waterline, where the tide reads them first.',
  sims: [0.7, 0.6, 0.5] as const,
  // Non-trivial so the deep-mode assertion cannot pass on an empty array.
  vector: Float32Array.from([1, 0]),
  chaptersOld: 0,
  pinSignal: 0,
  keywordHits: [],
  embeddingStale: false,
}

const loreBundle = () =>
  rankPerType([loreCandidate], 'lore', 10_000, {
    params: RANKER_DEFAULTS,
    chapterRanges: new Map(),
    countTokens: (text: string) => text.length,
  })

const queryStack = () =>
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

const successOutcome = () =>
  retrievalSuccess({ bundles: { lore: loreBundle() }, queries: queryStack() })

// A query-embed failure reaches the query stack but no pool (probe.md ->
// Failed captures): the sync-stage failure this defaults to reaches neither.
const failedOutcome = () =>
  retrievalFailure(
    { reason: 'call', detail: 'provider unreachable', staleCount: null },
    { queries: queryStack() },
  )

describe('buildCapturePayload', () => {
  it('carries the documented light-mode field inventory', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
      // Supplied even in light mode: proves the gate is capture_mode, not
      // merely "was a vector available to attach".
      queryVectors: [
        Float32Array.from([1, 0]),
        Float32Array.from([0, 1]),
        Float32Array.from([1, 0]),
      ],
    })

    expect(Object.keys(payload).sort()).toEqual([
      'branch_id',
      'capture_mode',
      'capture_version',
      'captured_at',
      'chapter_id',
      'embedding_model_id',
      'funnels',
      'params',
      'pools',
      'queries',
      'stale_counts',
      'structural_floor',
      'target_entry_id',
      'tokenizer',
    ])
    expect(payload.params.ranker).toEqual(RANKER_DEFAULTS)
    expect(payload.tokenizer.encoding).toBe('o200k_base')
    expect(payload.pools.lore[0].vector).toBeUndefined()
    expect(payload.queries[0].vector).toBeUndefined()
  })

  it('stores query and candidate vectors only in deep mode', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'deep',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
      queryVectors: [
        Float32Array.from([1, 0]),
        Float32Array.from([0, 1]),
        Float32Array.from([1, 0]),
      ],
    })

    expect(payload.pools.lore[0].vector).toEqual([1, 0])
    expect(payload.queries[0].vector).toEqual([1, 0])
  })

  it('sources a deep-mode candidate vector from the pool, not the selected set', () => {
    // Zero budget: the candidate is priced and ranked (not pre-filtered) but
    // dropped as candidate_too_large, so it lands in `pool` with a full trace
    // while `selected` is empty — the exact split that would hide its vector
    // if the mapping read `selected` instead of `pool`.
    const bundle = rankPerType([loreCandidate], 'lore', 0, {
      params: RANKER_DEFAULTS,
      chapterRanges: new Map(),
      countTokens: (text: string) => text.length,
    })
    expect(bundle.pool.length).toBe(1)
    expect(bundle.selected.length).toBe(0)

    const payload = buildCapturePayload({
      ...identity,
      mode: 'deep',
      settings,
      params: RANKER_DEFAULTS,
      outcome: retrievalSuccess({ bundles: { lore: bundle }, queries: queryStack() }),
    })

    expect(payload.pools.lore[0].selected).toBe(false)
    expect(payload.pools.lore[0].vector).toEqual([1, 0])
  })

  it('degrades cleanly in deep mode when queryVectors is not supplied', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'deep',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
    })

    expect(payload.queries.every((q) => q.vector === undefined)).toBe(true)
    // Candidate vectors are independent of queryVectors — they come from the
    // pool, not the query stack — so they still populate.
    expect(payload.pools.lore[0].vector).toEqual([1, 0])
  })

  it('carries the reached partial state on a failed pass', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: failedOutcome(),
    })

    expect(payload.queries[0].text).not.toBe('')
    // Task 8 made these records TOTAL over RetrievalType, so an unreached type
    // is an empty pool and a zeroed funnel — not an absent key.
    expect(Object.values(payload.pools).every((p) => p.length === 0)).toBe(true)
    expect(Object.values(payload.funnels).every((f) => f.pool_size === 0)).toBe(true)
    expect(payload.stale_counts.lore).toBe(0)
  })
})
