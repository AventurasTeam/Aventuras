import { describe, expect, it } from 'vitest'

import { CAPTURE_VERSION } from '@/lib/db'
import {
  buildQueryStack,
  buildStructuralFloor,
  countTokens,
  rankPerType,
  RANKER_DEFAULTS,
  TOKENIZER_IDENTITY,
} from '@/lib/retrieval'
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

const zeroFunnel = {
  pool_size: 0,
  pre_filtered_size: 0,
  selected_count: 0,
  tokens_used: 0,
  type_budget: 0,
}

const emptyQuery = { text: '', token_count: 0, source: 'user_action' as const }

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

// Priced with the real tokenizer, not a stand-in: the payload stamps
// tokenizer: o200k_base, so a fixture priced any other way would make the
// capture internally inconsistent with its own declared vocabulary.
const loreBundle = () =>
  rankPerType([loreCandidate], 'lore', 10_000, {
    params: RANKER_DEFAULTS,
    chapterRanges: new Map(),
    countTokens,
  })

const chapterCandidate = {
  kind: 'chapter' as const,
  id: 'ch_1',
  displayName: 'Chapter One: The Flood',
  renderedText: 'The city drowned before dawn.',
  sims: [0.9, 0.8, 0.7] as const,
  vector: Float32Array.from([0, 1]),
  chaptersOld: 0,
  pinSignal: 0,
  keywordHits: [],
  embeddingStale: false,
}

const chapterBundle = () =>
  rankPerType([chapterCandidate], 'chapters', 10_000, {
    params: RANKER_DEFAULTS,
    chapterRanges: new Map(),
    countTokens,
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
// Failed captures): the sync-stage failure below reaches neither.
const queryEmbedFailureOutcome = () =>
  retrievalFailure(
    { reason: 'call', detail: 'provider unreachable', staleCount: null },
    { queries: queryStack() },
  )

// retrievalFailure defaults `partial` to { queries: null, floor: null,
// bundles: {} } — the most restrictive real case, matching a sync-stage
// failure that never reached the query embed at all.
const syncStageFailureOutcome = () =>
  retrievalFailure({ reason: 'init', detail: 'embedder session never came up', staleCount: 40 })

// run.ts:325 seats chapters.bundles before the rest of the pass runs, because
// chapters rank first to feed the happenings boost — so a KNN failure after
// that point genuinely reaches a populated chapters bundle and four empty
// ones (probe.md -> Failed captures, "KNN error").
const knnFailureOutcome = () =>
  retrievalFailure(
    { reason: 'call', detail: 'KNN blew up', staleCount: null },
    { queries: queryStack(), bundles: { chapters: chapterBundle() } },
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

  it('stamps the capture identity fields from input, not swapped', () => {
    const payload = buildCapturePayload({
      branchId: 'br_1',
      targetEntryId: 'ent_1',
      chapterId: 'chap_9',
      capturedAt: 1_700_000_000_123,
      embeddingModelId: 'Xenova/all-MiniLM-L6-v2',
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
    })

    expect(payload).toMatchObject({
      branch_id: 'br_1',
      target_entry_id: 'ent_1',
      chapter_id: 'chap_9',
      captured_at: 1_700_000_000_123,
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
      capture_mode: 'light',
      capture_version: CAPTURE_VERSION,
    })
  })

  it('does not alias the tokenizer constant or the input budgets object', () => {
    const outcome = successOutcome()
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome,
    })

    expect(payload.tokenizer).toEqual(TOKENIZER_IDENTITY)
    expect(payload.tokenizer).not.toBe(TOKENIZER_IDENTITY)
    expect(payload.params.retrievalBudgets).toEqual(settings.retrievalBudgets)
    expect(payload.params.retrievalBudgets).not.toBe(settings.retrievalBudgets)
    expect(payload.stale_counts).not.toBe(outcome.staleCounts)
  })

  it('maps a candidate trace field-for-field into the pool, light mode', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
    })

    // Written out literally rather than re-derived from loreCandidate: that
    // would make a transposed or dropped field invisible, since most of these
    // values pass through the ranker unchanged from the candidate.
    expect(payload.pools.lore[0]).toEqual({
      target_kind: 'lore',
      target_id: 'lo_1',
      display_name: 'The drowned archive',
      display_text: 'Ledgers are kept below the waterline, where the tide reads them first.',
      sim_q1: 0.7,
      sim_q2: 0.6,
      sim_q3: 0.5,
      sim_blend: 0.605,
      recency_factor: 1,
      pin_signal: 0,
      chapters_old: 0,
      kw_boost_value: 0,
      chapter_boost_applied: false,
      bypass_triggered: false,
      final_score: 0.605,
      mmr_rank: 0,
      selected: true,
      drop_reason: 'not_dropped',
      tokens_estimated: 20,
      embedding_stale: false,
    })
  })

  it('prices each query with the real tokenizer', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
    })

    expect(payload.queries[0]).toEqual({
      text: 'Mira opens the ledger and reads the tide marks aloud.',
      token_count: 12,
      source: 'user_action',
    })
  })

  it('captures the success arm real stale counts, not constant zeros', () => {
    const outcome = retrievalSuccess({
      bundles: { lore: loreBundle() },
      queries: queryStack(),
      staleCounts: { entities: 1, lore: 3 },
    })

    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome,
    })

    expect(payload.stale_counts).toEqual({
      entities: 1,
      lore: 3,
      happenings: 0,
      threads: 0,
      chapters: 0,
    })
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
      countTokens,
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
    expect(payload.pools.lore[0].drop_reason).toBe('candidate_too_large')
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

  it('carries the reached partial state on a query-embed failure', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: queryEmbedFailureOutcome(),
    })

    expect(payload.queries[0].text).not.toBe('')
    // Task 8 made these records TOTAL over RetrievalType, so an unreached type
    // is an empty pool and a zeroed funnel — not an absent key.
    expect(payload.pools).toEqual({
      entities: [],
      lore: [],
      happenings: [],
      threads: [],
      chapters: [],
    })
    expect(payload.funnels).toEqual({
      entities: zeroFunnel,
      lore: zeroFunnel,
      happenings: zeroFunnel,
      threads: zeroFunnel,
      chapters: zeroFunnel,
    })
    expect(payload.stale_counts.lore).toBe(0)
  })

  it('captures nothing but empty queries and zeroed funnels on a sync-stage failure', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: syncStageFailureOutcome(),
    })

    expect(payload.queries).toEqual([emptyQuery, emptyQuery, emptyQuery])
    expect(payload.pools).toEqual({
      entities: [],
      lore: [],
      happenings: [],
      threads: [],
      chapters: [],
    })
    expect(payload.funnels).toEqual({
      entities: zeroFunnel,
      lore: zeroFunnel,
      happenings: zeroFunnel,
      threads: zeroFunnel,
      chapters: zeroFunnel,
    })
    expect(payload.structural_floor).toEqual([])
  })

  it('captures a populated chapters bundle and four empty ones on a KNN failure', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: knnFailureOutcome(),
    })

    expect(payload.pools.chapters).toHaveLength(1)
    expect(payload.pools.chapters[0].target_id).toBe('ch_1')
    expect(payload.funnels.chapters.pool_size).toBe(1)
    expect(payload.pools.entities).toEqual([])
    expect(payload.pools.lore).toEqual([])
    expect(payload.pools.happenings).toEqual([])
    expect(payload.pools.threads).toEqual([])
    expect(payload.funnels.entities).toEqual(zeroFunnel)
    expect(payload.funnels.lore).toEqual(zeroFunnel)
    expect(payload.funnels.happenings).toEqual(zeroFunnel)
    expect(payload.funnels.threads).toEqual(zeroFunnel)
  })

  it('emits one structural-floor row per seated entity, location, thread and always-row', () => {
    const floor = buildStructuralFloor({
      entities: [
        {
          id: 'e_scene',
          kind: 'character',
          status: 'active',
          injectionMode: 'auto',
          name: 'Mira',
          description: 'a courier',
        },
        {
          id: 'e_loc',
          kind: 'location',
          status: 'active',
          injectionMode: 'auto',
          name: 'The drowned archive',
          description: 'half-flooded stacks',
        },
        {
          id: 'e_always',
          kind: 'character',
          status: 'retired',
          injectionMode: 'always',
          name: 'The Warden',
          description: 'a ghost who still audits the ledgers',
        },
      ],
      lore: [
        {
          id: 'l_always',
          title: 'The Flood Accord',
          body: 'Every archive keeps one drowned shelf.',
          injectionMode: 'always',
          priority: 50,
        },
      ],
      threads: [
        {
          id: 't_active',
          status: 'active',
          injectionMode: 'auto',
          title: 'Find the missing ledger',
          description: 'Mira needs it before the tide returns',
        },
        {
          id: 't_always',
          status: 'pending',
          injectionMode: 'always',
          title: "The Warden's Contract",
          description: 'a debt owed across generations',
        },
      ],
      sceneEntityIds: ['e_scene'],
      currentLocationId: 'e_loc',
    })

    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: retrievalSuccess({ floor }),
    })

    // Token counts come from the real tokenizer on each row's own text — an
    // independent oracle from the mapping under test — while target_kind and
    // target_id are written out literally per branch, which is what catches
    // a branch reusing the wrong kind (e.g. alwaysLore stamped 'thread').
    expect(payload.structural_floor).toEqual([
      { target_kind: 'entity', target_id: 'e_scene', tokens: countTokens('a courier') },
      { target_kind: 'entity', target_id: 'e_loc', tokens: countTokens('half-flooded stacks') },
      {
        target_kind: 'thread',
        target_id: 't_active',
        tokens: countTokens('Mira needs it before the tide returns'),
      },
      {
        target_kind: 'entity',
        target_id: 'e_always',
        tokens: countTokens('a ghost who still audits the ledgers'),
      },
      {
        target_kind: 'lore',
        target_id: 'l_always',
        tokens: countTokens('Every archive keeps one drowned shelf.'),
      },
      {
        target_kind: 'thread',
        target_id: 't_always',
        tokens: countTokens('a debt owed across generations'),
      },
    ])
  })
})
