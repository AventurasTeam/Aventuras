import { describe, expect, it } from 'vitest'

import { CAPTURE_VERSION, type ProbeCapturePayload } from '@/lib/db'
import { MEMORY_BLOCKS } from '@/lib/prompts/bundled/memory-blocks'
import { PER_TURN_NARRATIVE } from '@/lib/prompts/bundled/per-turn'
import { STATE_EMISSION } from '@/lib/prompts/bundled/state-emission'
import { createEngine } from '@/lib/prompts/engine'
import { MACRO_IDS } from '@/lib/prompts/ids'
import type { Pack } from '@/lib/prompts/types'
import {
  buildStructuralFloor,
  countTokens,
  rankPerType,
  RANKER_DEFAULTS,
  TOKENIZER_IDENTITY,
  type EntityRow,
  type LoreRow,
  type RetrievalType,
  type ThreadRow,
} from '@/lib/retrieval'
import { retrievalFailure, retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'

import {
  loreBundle,
  loreCandidate,
  queryStack,
  settings,
  successOutcome,
} from './__tests__/fixtures'
import { buildCapturePayload } from './payload'

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

const ALL_TYPES: readonly RetrievalType[] = [
  'entities',
  'lore',
  'happenings',
  'threads',
  'chapters',
]

// TOTAL over RetrievalType: an unreached type is an empty pool and a zeroed
// funnel, never an absent key. `except` lists types the caller asserts itself.
const expectEmptyPools = (payload: ProbeCapturePayload, except: readonly RetrievalType[] = []) => {
  for (const type of ALL_TYPES) {
    if (except.includes(type)) continue
    expect(payload.pools[type]).toEqual([])
    expect(payload.funnels[type]).toEqual(zeroFunnel)
  }
}

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

// A query-embed failure reaches the query stack but no pool (probe.md ->
// Failed captures): the sync-stage failure below reaches neither.
const queryEmbedFailureOutcome = () =>
  retrievalFailure(
    { reason: 'call', detail: 'provider unreachable', staleCount: null },
    { queries: queryStack() },
  )

const syncStageFailureOutcome = () =>
  retrievalFailure({ reason: 'init', detail: 'embedder session never came up', staleCount: 40 })

// runRetrievalPass seats chapters.bundles before the rest of the pass, because
// chapters rank first to feed the happenings boost — so a KNN failure after
// that point genuinely reaches a populated chapters bundle and four empty
// ones (probe.md -> Failed captures, "KNN error").
const knnFailureOutcome = () =>
  retrievalFailure(
    { reason: 'call', detail: 'KNN blew up', staleCount: null },
    { queries: queryStack(), bundles: { chapters: chapterBundle() } },
  )

const FLOOR_ENTITIES: EntityRow[] = [
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
]

const FLOOR_LORE: LoreRow[] = [
  {
    id: 'l_always',
    title: 'The Flood Accord',
    body: 'Every archive keeps one drowned shelf.',
    injectionMode: 'always',
    priority: 50,
  },
]

const FLOOR_THREADS: ThreadRow[] = [
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
    // Long enough to land on a token count distinct from every other branch —
    // active_thread and the original wording both priced to 13, which would
    // have let the two branches' formulas swap unnoticed.
    description: 'a debt owed across three generations',
  },
]

// The exact string each floor branch renders, shared by the payload assertion
// and by the drift check that renders the real bundled templates. Every count
// is distinct from every other's — a shared value would hide one branch's
// formula silently taking another's.
const FLOOR_TEXTS = {
  sceneEntity: '## Mira\na courier',
  currentLocation: 'The drowned archive: half-flooded stacks',
  activeThread: 'Find the missing ledger\nMira needs it before the tide returns',
  alwaysEntity: 'The Warden: a ghost who still audits the ledgers',
  alwaysLore: 'The Flood Accord\nEvery archive keeps one drowned shelf.',
  alwaysThread: "The Warden's Contract (pending)\na debt owed across three generations",
}

const floorFixture = () =>
  buildStructuralFloor({
    entities: FLOOR_ENTITIES,
    lore: FLOOR_LORE,
    threads: FLOOR_THREADS,
    sceneEntityIds: ['e_scene'],
    currentLocationId: 'e_loc',
  })

describe('buildCapturePayload', () => {
  it('carries the documented light-mode field inventory', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
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

  it('does not alias the query stack sentence_scores array', () => {
    const stack = queryStack()
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: retrievalSuccess({ bundles: { lore: loreBundle() }, queries: stack }),
    })

    expect(payload.queries[2].sentence_scores).toEqual(stack.q3.sentenceScores)
    expect(payload.queries[2].sentence_scores).not.toBe(stack.q3.sentenceScores)
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
    // would make a transposed or dropped field invisible.
    expect(payload.pools.lore[0]).toEqual({
      target_kind: 'lore',
      target_id: 'lo_1',
      display_name: 'The drowned archive',
      display_text: 'Ledgers are kept below the waterline, where the tide reads them first.',
      sim_q1: 0.95,
      sim_q2: 0.9,
      sim_q3: 0.85,
      sim_blend: 0.9025,
      recency_factor: 1,
      pin_signal: 0.4,
      chapters_old: 3,
      kw_boost_value: 0.1,
      chapter_boost_applied: false,
      bypass_triggered: true,
      final_score: 1.09275,
      mmr_rank: 0,
      selected: true,
      drop_reason: 'not_dropped',
      tokens_estimated: 20,
      embedding_stale: true,
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

  it('stores candidate vectors in deep mode, and no query vector in either', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'deep',
      settings,
      params: RANKER_DEFAULTS,
      outcome: successOutcome(),
    })

    expect(payload.pools.lore[0].vector).toEqual([1, 0])
    expect(payload.queries.every((q) => !('vector' in q))).toBe(true)
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

  it('carries the reached partial state on a query-embed failure', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: queryEmbedFailureOutcome(),
    })

    expect(payload.queries[0].text).not.toBe('')
    expectEmptyPools(payload)
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

    expect(payload.queries).toEqual([
      { text: '', token_count: 0, source: 'user_action' },
      { text: '', token_count: 0, source: 'structural_digest' },
      { text: '', token_count: 0, source: 'prose_extract' },
    ])
    expectEmptyPools(payload)
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
    expectEmptyPools(payload, ['chapters'])
  })

  it('emits one structural-floor row per seated entity, location, thread and always-row', () => {
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: retrievalSuccess({ floor: floorFixture() }),
    })

    // Priced through the real tokenizer as an independent oracle; the strings
    // themselves are pinned against the bundled templates below.
    expect(payload.structural_floor).toEqual([
      {
        target_kind: 'entity',
        target_id: 'e_scene',
        tokens: countTokens(FLOOR_TEXTS.sceneEntity),
      },
      {
        target_kind: 'entity',
        target_id: 'e_loc',
        tokens: countTokens(FLOOR_TEXTS.currentLocation),
      },
      {
        target_kind: 'thread',
        target_id: 't_active',
        tokens: countTokens(FLOOR_TEXTS.activeThread),
      },
      {
        target_kind: 'entity',
        target_id: 'e_always',
        tokens: countTokens(FLOOR_TEXTS.alwaysEntity),
      },
      {
        target_kind: 'lore',
        target_id: 'l_always',
        tokens: countTokens(FLOOR_TEXTS.alwaysLore),
      },
      {
        target_kind: 'thread',
        target_id: 't_always',
        tokens: countTokens(FLOOR_TEXTS.alwaysThread),
      },
    ])

    const tokenCounts = payload.structural_floor.map((r) => r.tokens)
    expect(new Set(tokenCounts).size).toBe(tokenCounts.length)
  })
})

// payload.ts reimplements six Liquid render formulas by hand, so the assertion
// above alone pins them only against themselves. Rendering the real bundled
// templates over the same floor is what makes template drift fail a test.
function renderFloor(piggybackFires: boolean): string {
  const floor = floorFixture()
  const pack: Pack = {
    templates: { t: { group: 'generationContext', source: PER_TURN_NARRATIVE } },
    macros: {
      [MACRO_IDS.memoryBlocks]: { group: 'staticContent', source: MEMORY_BLOCKS },
      [MACRO_IDS.outputFormatNarrative]: { group: 'staticContent', source: 'FMT' },
      [MACRO_IDS.stateEmission]: { group: 'staticContent', source: STATE_EMISSION },
    },
  }
  return createEngine(pack).renderFileSync('t', {
    definition: { mode: 'adventure', genre: { promptBody: '' }, tone: { promptBody: '' } },
    entries: [],
    entities: FLOOR_ENTITIES,
    sceneEntities: ['e_scene'],
    structuralLocation: floor.currentLocation,
    structuralActiveThreads: floor.activeThreads,
    structuralPinnedEntities: floor.alwaysEntities,
    structuralPinnedLore: floor.alwaysLore,
    structuralPinnedThreads: floor.alwaysThreads,
    retrievedEntities: [],
    retrievedLore: [],
    retrievedHappenings: [],
    retrievedThreads: [],
    retrievedChapters: [],
    locationIds: [],
    piggybackFires,
  }) as string
}

describe('structural-floor formulas match the templates that render them', () => {
  it.each(Object.entries(FLOOR_TEXTS))('renders the %s row verbatim', (_branch, text) => {
    expect(renderFloor(false)).toContain(text)
  })

  // The gap probe.md → Structural floor records: piggyback firing is decided
  // after retrieval, so a capture cannot know it, and the three entity rows
  // below are priced without the id affix a piggyback turn adds.
  it('undercounts the three entity rows on a piggyback turn', () => {
    const rendered = renderFloor(true)
    const payload = buildCapturePayload({
      ...identity,
      mode: 'light',
      settings,
      params: RANKER_DEFAULTS,
      outcome: retrievalSuccess({ floor: floorFixture() }),
    })
    const tokensOf = (id: string) =>
      payload.structural_floor.find((r) => r.target_id === id)?.tokens

    for (const [id, affixed] of [
      ['e_scene', '## Mira [e_scene]\na courier'],
      ['e_loc', '[e_loc] The drowned archive: half-flooded stacks'],
      ['e_always', '[e_always] The Warden: a ghost who still audits the ledgers'],
    ]) {
      expect(rendered).toContain(affixed)
      expect(tokensOf(id!)).toBeLessThan(countTokens(affixed!))
    }

    // The three non-entity branches carry no affix, so they stay exact.
    expect(rendered).toContain(FLOOR_TEXTS.activeThread)
    expect(rendered).toContain(FLOOR_TEXTS.alwaysLore)
    expect(rendered).toContain(FLOOR_TEXTS.alwaysThread)
  })
})
