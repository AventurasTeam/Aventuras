import type { DatabaseSync } from 'node:sqlite'

import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_SINGLETON_ID,
  appSettings,
  STORY_SETTINGS_DEFAULTS,
  type DbCtx,
  type Entity,
  type EntryMetadata,
  type ProbeCapturePayload,
  type Story,
  type StoryEntry,
  type StorySettings,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import type { Logger } from '@/lib/diagnostics'
import { __resetCaptureMode, armDeepCapture, decompressPayload } from '@/lib/probe'
import {
  RANKER_DEFAULTS,
  type CandidateTrace,
  type InjectedAwareness,
  type QueryStack,
  type RankedType,
  type RetrievalParams,
  type RetrievalSuccess,
  type RetrievalTimings,
  type RetrievalType,
  type runRetrieval,
} from '@/lib/retrieval'
import { retrievalFailure, retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'
import {
  currentStoryStore,
  entitiesStore,
  entriesStore,
  rehydrateAppSettings,
  resetAllStores,
  storiesStore,
} from '@/lib/stores'

import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './per-turn'
import { RETRIEVAL_INTERMEDIATE_KEY, RETRIEVAL_PHASE_NAME } from './per-turn-retrieval'
import { getPipeline } from '../authoring/registry'
import type { PhaseEmittedEvent, PhaseResult } from '../types'

// Typed rather than a bare `vi.fn()` so a mocked resolution missing `partial`
// fails to compile instead of silently feeding the phase `undefined`.
const { runRetrievalMock, refreshEmbeddingStatusMock } = vi.hoisted(() => ({
  runRetrievalMock: vi.fn<typeof runRetrieval>(),
  refreshEmbeddingStatusMock: vi.fn(),
}))

vi.mock('@/lib/retrieval', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, runRetrieval: runRetrievalMock }
})

vi.mock('@/lib/actions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, refreshEmbeddingStatus: refreshEmbeddingStatusMock }
})

const definition = {
  mode: 'adventure' as const,
  leadEntityId: 'char_hero',
  narration: 'first' as const,
  genre: { label: 'Fantasy', promptBody: 'High fantasy.' },
  tone: { label: 'Wry', promptBody: 'Dry humor.' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

// Non-zero defaults for the three fields this phase forwards, so a test that
// asserts on them fails on a dropped value rather than agreeing with the
// factory's zeros by coincidence.
function okOutcome({
  injectedAwareness = [{ id: 'haw_1', retrievalCount: 0 }],
  timings = { totalMs: 12, syncMs: 3, embedMs: 4, knnMs: 2, rankMs: 1 },
  bundleOverrides,
  ...over
}: {
  staleCounts?: Record<RetrievalType, number>
  injectedAwareness?: InjectedAwareness[]
  timings?: RetrievalTimings
  bundleOverrides?: Partial<Record<RetrievalType, RankedType>>
} = {}): RetrievalSuccess {
  return retrievalSuccess({ ...over, injectedAwareness, timings, bundles: bundleOverrides })
}

function bumpEvent(id: string, priorCount = 0): PhaseEmittedEvent {
  return {
    type: 'delta_emitted',
    action: {
      kind: 'bumpAwarenessRetrieval',
      source: 'ai_classifier',
      payload: { branchId: 'b1', id, priorCount },
    },
  }
}

const OK_OUTCOME = okOutcome()

function storyRow(settings: StorySettings, id = 's1'): Story {
  return {
    id,
    title: 'A story',
    description: null,
    tags: [],
    coverAssetId: null,
    accentColor: null,
    status: 'active',
    favorite: 0,
    lastOpenedAt: null,
    definition,
    settings,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: 'b1',
  }
}

function entry(
  position: number,
  kind: StoryEntry['kind'],
  content: string,
  metadata: EntryMetadata | null = null,
): StoryEntry {
  return {
    id: `entry_${position}`,
    branchId: 'b1',
    position,
    kind,
    content,
    chapterId: null,
    metadata,
    createdAt: position,
  }
}

function meta(overrides: Partial<EntryMetadata> = {}): EntryMetadata {
  return { sceneEntities: [], currentLocationId: null, worldTime: 0, ...overrides }
}

function entity(id: string, kind: Entity['kind'], name: string): Entity {
  return {
    id,
    branchId: 'b1',
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function seedOpenStory(
  opts: {
    settings?: Partial<StorySettings>
    entries?: StoryEntry[]
    entities?: Entity[]
    entriesBranch?: string
    storyId?: string
  } = {},
): StorySettings {
  const settings: StorySettings = { ...STORY_SETTINGS_DEFAULTS, ...opts.settings }
  currentStoryStore.set({
    storyId: opts.storyId ?? 's1',
    branchId: 'b1',
    definition,
    settings,
  })
  entriesStore.hydrate(opts.entriesBranch ?? 'b1', opts.entries ?? [])
  entitiesStore.hydrate('b1', opts.entities ?? [])
  vi.spyOn(storiesStore, 'getStories').mockReturnValue({
    rows: [storyRow(settings, opts.storyId ?? 's1')],
    openFailures: {},
  })
  return settings
}

function openOnBranch(branchId: string): void {
  const open = currentStoryStore.getCurrentStory()
  if (!open) throw new Error('seedOpenStory must run first')
  currentStoryStore.set({ ...open, branchId })
}

async function runRetrievalPhase(
  abortSignal = new AbortController().signal,
  runInTransaction: DbCtx['runInTransaction'] = async () => undefined,
): Promise<{
  result: PhaseResult
  events: PhaseEmittedEvent[]
  intermediates: Record<string, unknown>
  log: { [K in keyof Logger]: ReturnType<typeof vi.fn> }
}> {
  ensurePerTurnPipelineRegistered()
  const node = getPipeline(PER_TURN_KIND).phases.find((n) => n.name === RETRIEVAL_PHASE_NAME)
  if (!node || !('run' in node)) throw new Error('expected a single-run retrieval phase node')
  const intermediates: Record<string, unknown> = {}
  // A fake logger rather than makeLogger: the real one drops everything when the
  // diagnostics gate is off, which is the default in unit tests.
  const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
  const gen = node.run({
    actionId: 'act_1',
    abortSignal,
    intermediates,
    log,
    db: {} as never,
    runInTransaction,
    storyId: 's1',
    branchId: 'b1',
  })
  const events: PhaseEmittedEvent[] = []
  let next = await gen.next()
  while (!next.done) {
    events.push(next.value)
    next = await gen.next()
  }
  return { result: next.value, events, intermediates, log }
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

const EMPTY_SUMMARY = { pool: 0, kept: 0, selected: 0, tokens: 0, topScore: null }

function trace(id: string, finalScore: number, mmrRank: number): CandidateTrace {
  return {
    kind: 'lore',
    id,
    displayName: 'The drowned archive',
    simQ1: 0.71,
    simQ2: 0.62,
    simQ3: 0.53,
    simBlend: 0.64,
    recencyFactor: 0.98,
    pinSignal: 0.41,
    chaptersOld: 2,
    renderedText: 'Ledgers are kept below the waterline, where the tide reads them first.',
    kwBoostValue: 0.06,
    chapterBoostApplied: false,
    bypassTriggered: false,
    finalScore,
    mmrRank,
    selected: true,
    dropReason: 'not_dropped',
    tokensEstimated: 12,
    embeddingStale: false,
  }
}

function scoredBundle(): RankedType {
  return {
    selected: [],
    traces: [trace('lo_1', 0.87, 0), trace('lo_2', 0.12, 1)],
    funnel: { poolSize: 9, preFilteredSize: 7, selectedCount: 3, tokensUsed: 145, typeBudget: 600 },
    pool: [],
  }
}

const QUERY_TEXTS = [
  'Mira opens the ledger and reads the tide marks aloud.',
  'Scene: the drowned archive. Present: Mira. Threads: the missing courier.',
  'A courier arrived at dusk carrying nothing but an empty seal case.',
] as const

const queryStack = (): QueryStack => ({
  q1: { text: QUERY_TEXTS[0], source: 'user_action' },
  q2: { text: QUERY_TEXTS[1], source: 'structural_digest' },
  q3: { text: QUERY_TEXTS[2], source: 'prose_extract' },
  presence: [true, true, true],
  embedTexts: [...QUERY_TEXTS],
})

type CaptureRow = {
  branch_id: string
  target_entry_id: string
  capture_mode: string
  embedding_model_id: string | null
  failure_reason: string | null
  payload: Uint8Array
}

const captureRows = (sqlite: DatabaseSync): CaptureRow[] =>
  sqlite.prepare('SELECT * FROM probe_captures ORDER BY rowid').all() as CaptureRow[]

const payloadOf = (row: CaptureRow): ProbeCapturePayload =>
  decompressPayload(row.payload) as ProbeCapturePayload

// Captures commit through the run's own transaction handle, so a test that
// reads them back needs a real db behind that handle.
async function probeDb() {
  const testDb = await createTestDb()
  testDb.sqlite.exec(`
    INSERT INTO stories (id, title, created_at, updated_at) VALUES ('s1', 'A story', 1, 1);
    INSERT INTO branches (id, story_id, name, created_at) VALUES ('b1', 's1', 'main', 1);
  `)
  await testDb.db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
  return testDb
}

// Persist-then-rehydrate: the store applies a fresh diagnostics object, which
// is what a gate read once would keep pointing past.
async function setAppGate(db: Awaited<ReturnType<typeof probeDb>>['db'], enabled: boolean) {
  await db
    .update(appSettings)
    .set({ diagnostics: { enabled, debug_level_enabled: false } })
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  await rehydrateAppSettings(db)
}

// Every capture is keyed to the entry that drove the pass, so a probe test
// without one exercises the skip path instead of the write.
const seedProbeStory = (settings: Partial<StorySettings>): StorySettings =>
  seedOpenStory({
    settings,
    entries: [
      entry(1, 'opening', 'The keep stands.', meta()),
      entry(2, 'user_action', 'I draw the blade.', meta()),
    ],
  })

function lastParams(): RetrievalParams {
  const call = runRetrievalMock.mock.calls.at(-1)
  if (!call) throw new Error('runRetrieval was never called')
  return call[1] as RetrievalParams
}

// The phase imports @/lib/actions lazily, to break a require cycle — so unlike
// the ten test files that import that barrel statically, this file resolves it
// (and, through the mock factory's importOriginal, the real module graph behind
// it) inside the first test that gets past the working-set guards. That puts
// module resolution inside a 5s test timeout instead of ahead of it. Resolve it
// here, where no test timeout applies.
beforeAll(async () => {
  await import('@/lib/actions')
}, 60_000)

beforeEach(() => {
  vi.restoreAllMocks()
  runRetrievalMock.mockReset().mockResolvedValue(OK_OUTCOME)
  refreshEmbeddingStatusMock.mockReset().mockResolvedValue(undefined)
  resetAllStores()
  __resetCaptureMode()
})

// A hook, not an inline call after the awaited phase: a mock that throws rejects
// that await, and fake timers left installed turn one failure into a cascade of
// unrelated ones. No-op when the test never installed them.
afterEach(() => {
  vi.useRealTimers()
})

describe('per-turn phase order (C6)', () => {
  it('inserts retrieval before narrative and after user-action-translation', () => {
    ensurePerTurnPipelineRegistered()
    const names = getPipeline(PER_TURN_KIND).phases.map((p) => p.name)
    expect(names).toContain(RETRIEVAL_PHASE_NAME)
    expect(names.indexOf(RETRIEVAL_PHASE_NAME)).toBeGreaterThan(
      names.indexOf('user-action-translation'),
    )
    expect(names.indexOf(RETRIEVAL_PHASE_NAME)).toBeLessThan(names.indexOf('narrative'))
  })

  it('leaves the piggyback fallback classifier after narrative', () => {
    ensurePerTurnPipelineRegistered()
    const names = getPipeline(PER_TURN_KIND).phases.map((p) => p.name)
    expect(names.indexOf('narrative')).toBeLessThan(names.indexOf('piggyback-fallback-classifier'))
  })

  it('declares no resolver inputs — retrieval makes no LLM call', () => {
    ensurePerTurnPipelineRegistered()
    const phases = getPipeline(PER_TURN_KIND).phases
    const retrieval = phases.find((p) => p.name === RETRIEVAL_PHASE_NAME)
    const narrative = phases.find((p) => p.name === 'narrative')
    expect(retrieval && 'resolves' in retrieval ? retrieval.resolves : undefined).toBeUndefined()
    // Positive control: `resolves` is a real, populated field on the phases that
    // DO make a call, so the assertion above discriminates rather than reading
    // a key the node shape never carries.
    expect(narrative && 'resolves' in narrative ? narrative.resolves : undefined).toEqual([
      { target: 'narrative' },
    ])
  })
})

describe('retrieval phase — store-desync guards', () => {
  it('fails when no story is open for the run branch', async () => {
    seedOpenStory({ storyId: 's2' })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'retrieval: no open story for branch' },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  // Distinct from the story mismatch above: the open story is the right STORY on
  // the wrong BRANCH, and every other store here is loaded for the run's branch,
  // so only the branch arm of the guard can catch it.
  it('fails when the open story sits on another branch of the same story', async () => {
    seedOpenStory()
    openOnBranch('b-other')

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'retrieval: no open story for branch' },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  it('fails when the entries store is loaded for another branch', async () => {
    seedOpenStory({ entriesBranch: 'b-other' })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: 'retrieval: entries store loaded for another branch',
      },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })
})

describe('retrieval phase — embedder config', () => {
  it('fails blocking when the embedder config does not resolve', async () => {
    seedOpenStory({ settings: { embeddingBackend: 'provider', embedding_provider_id: undefined } })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'embedder not configured: no-provider',
        // Nothing counted anything — this failed before the dirty set was read.
        staleCount: null,
      },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  it('fails blocking when the config resolves but its read dim is still unknown', async () => {
    seedOpenStory({
      settings: {
        embeddingBackend: 'provider',
        embedding_provider_id: 'prov-1',
        embedding_model_id: 'text-embedding-3-small',
      },
    })

    const { result } = await runRetrievalPhase()

    // toEqual, not toMatchObject: only `detail` separates this from the
    // config-resolution failure above, so dropping it would let a config
    // resolver that rejects the unknown provider id pass as this guard.
    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'embedder dim unknown for model text-embedding-3-small',
        staleCount: null,
      },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  it('runs the pass on a resolvable local config', async () => {
    seedOpenStory()

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(runRetrievalMock).toHaveBeenCalledTimes(1)
  })
})

describe('retrieval phase — blocking failure mapping', () => {
  it('maps an init failure with a stale-row magnitude field by field', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      retrievalFailure({ reason: 'init', detail: 'no embedder integration', staleCount: 7 }),
    )

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'no embedder integration',
        staleCount: 7,
      },
    })
  })

  // Second arm so no field can be hardcoded: reason, detail and staleCount all
  // differ from the case above.
  it('maps a call failure whose magnitude is unknown', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      retrievalFailure({ reason: 'call', detail: 'query embed served dim 512', staleCount: null }),
    )

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'call',
        detail: 'query embed served dim 512',
        staleCount: null,
      },
    })
  })

  it('stashes nothing on the intermediates when the pass fails', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      retrievalFailure({ reason: 'call', detail: 'boom', staleCount: null }),
    )

    const { intermediates, events } = await runRetrievalPhase()

    expect(intermediates).toEqual({})
    // Failure returns, never emits: a `recoverable_error` event here would let
    // the orchestrator keep the turn running past a blocking embed failure.
    expect(events).toEqual([])
  })
})

describe('retrieval phase — success', () => {
  it('stashes the outcome for the narrative phase and bumps the injected awareness row', async () => {
    seedOpenStory()

    const { result, events, intermediates } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(intermediates[RETRIEVAL_INTERMEDIATE_KEY]).toBe(OK_OUTCOME)
    expect(events).toEqual([bumpEvent('haw_1')])
  })

  it('bumps every injected awareness row, one delta each', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      okOutcome({
        injectedAwareness: [
          { id: 'haw_1', retrievalCount: 0 },
          { id: 'haw_2', retrievalCount: 3 },
          { id: 'haw_3', retrievalCount: 0 },
        ],
      }),
    )

    const { events } = await runRetrievalPhase()

    // haw_2's prior is 3, not 0: the handler no longer reads the row, so a phase
    // that dropped the count would bump it from the wrong base.
    expect(events).toEqual([bumpEvent('haw_1'), bumpEvent('haw_2', 3), bumpEvent('haw_3')])
  })

  // outcome.timings measures the pass and is computed before the bumps, so the
  // dispatch cost was invisible to the one log AC7 added for per-turn cost. The
  // orchestrator suspends this generator while it applies each delta, so the
  // span covers the handler reads and transactions, not just the yields.
  it('reports the bump dispatch span apart from the pass timing', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      okOutcome({
        injectedAwareness: [
          { id: 'haw_1', retrievalCount: 0 },
          { id: 'haw_2', retrievalCount: 3 },
          { id: 'haw_3', retrievalCount: 0 },
        ],
      }),
    )

    const { log } = await runRetrievalPhase()

    expect(log.debug).toHaveBeenCalledWith('retrieval.bump_dispatch', {
      count: 3,
      ms: expect.any(Number) as unknown as number,
    })
  })

  // Not a degenerate shape: runRetrieval admits a common-knowledge happening
  // with no in-scene awareness row, so a turn can select happenings and still
  // report no ids to bump.
  it('emits nothing when the pass injected no awareness rows', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(okOutcome({ injectedAwareness: [] }))

    const { result, events, log } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    // No bumps, no span — an empty measurement is noise in the log.
    expect(log.debug).not.toHaveBeenCalledWith(
      'retrieval.bump_dispatch',
      expect.anything() as unknown as Record<string, unknown>,
    )
  })

  it('hands the pass the full dep surface, not just the query embedder', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    const deps = runRetrievalMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    // Key-set equality, not spot checks: the embed trio arrives as one spread,
    // so dropping it leaves queryAll/runInTransaction in place and every
    // params-shaped assertion in this file still green.
    expect(Object.keys(deps).sort()).toEqual([
      'abortSignal',
      'embedRows',
      'embedTexts',
      'loadStaleRows',
      'onRowsSynced',
      'queryAll',
      'runInTransaction',
    ])
    for (const key of ['embedRows', 'embedTexts', 'loadStaleRows', 'queryAll', 'runInTransaction'])
      expect(typeof deps[key]).toBe('function')
  })
})

describe('retrieval phase — abort', () => {
  it('aborts before the pass when the turn was cancelled during the lazy import', async () => {
    seedOpenStory()

    const { result } = await runRetrievalPhase(abortedSignal())

    expect(result).toEqual({ status: 'aborted' })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  // An expiry aborts the pass the same way a cancel does, so reading the bounded
  // signal after it would report every stalled provider as a user cancel: draft
  // restored, no error, no Switch embedder, retrying into the same dead endpoint.
  it('reports a timed-out embed as a blocking failure, not as a cancel', async () => {
    seedOpenStory()
    vi.useFakeTimers()
    runRetrievalMock.mockImplementation(async (deps: { abortSignal?: AbortSignal }) => {
      vi.advanceTimersByTime(300_000)
      if (deps.abortSignal?.aborted !== true) throw new Error('expected the bounded signal to fire')
      return retrievalFailure({ reason: 'call', detail: 'aborted', staleCount: null })
    })

    const { result } = await runRetrievalPhase()

    expect(result).toMatchObject({
      status: 'failed',
      error: { kind: 'embedder', reason: 'call', detail: 'embed timed out after 300000ms' },
    })
  })

  it('aborts after a pass the cancel landed mid-way through, stashing nothing', async () => {
    seedOpenStory()
    const controller = new AbortController()
    runRetrievalMock.mockImplementation(async () => {
      controller.abort()
      return OK_OUTCOME
    })

    const { result, events, intermediates } = await runRetrievalPhase(controller.signal)

    // Distinct from the case above: the pass DID run, so only the poll after it
    // can catch this.
    expect(runRetrievalMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'aborted' })
    expect(intermediates).toEqual({})
    // The outcome reported haw_1 as injected; the bumps sit downstream of the
    // poll so a cancelled turn leaves no counter for reverse-replay to walk back.
    expect(events).toEqual([])
  })

  it('emits no awareness bumps when cancel lands during probe capture persistence', async () => {
    const { db, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({ probe_mode_active: true })
    const controller = new AbortController()
    let markCaptureStarted!: () => void
    const captureStarted = new Promise<void>((resolve) => {
      markCaptureStarted = resolve
    })
    let releaseCapture!: () => void
    const capturePending = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    const controlledCaptureWrite: DbCtx['runInTransaction'] = async (ops) => {
      markCaptureStarted()
      await capturePending
      await runInTransaction(ops)
    }

    const phase = runRetrievalPhase(controller.signal, controlledCaptureWrite)
    await captureStarted
    controller.abort()
    releaseCapture()
    const { result, events } = await phase

    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
  })

  it('reports a cancelled turn as aborted even when the pass also failed', async () => {
    seedOpenStory()
    const controller = new AbortController()
    runRetrievalMock.mockImplementation(async () => {
      controller.abort()
      return retrievalFailure({ reason: 'call', detail: 'boom', staleCount: null })
    })

    const { result, log } = await runRetrievalPhase(controller.signal)

    // Same precedence as narrativePhase: a cancel outranks whatever the work it
    // cancelled reported, so a stopped turn raises no failure banner.
    expect(result).toEqual({ status: 'aborted' })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('completes the same pass when nothing cancels it', async () => {
    seedOpenStory()

    const { result, intermediates } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(intermediates[RETRIEVAL_INTERMEDIATE_KEY]).toBe(OK_OUTCOME)
    expect(runRetrievalMock).toHaveBeenCalledWith(
      expect.objectContaining({ onRowsSynced: expect.any(Function) }),
      expect.anything(),
    )
  })

  // The hook runs after the sync stage has committed, so a rejected recount must
  // not fail a turn that can still complete — and must not vanish either.
  it('survives a post-sync recount that rejects, warning instead of failing', async () => {
    seedOpenStory()
    refreshEmbeddingStatusMock.mockRejectedValue(new Error('recount hit a locked db'))
    runRetrievalMock.mockImplementation(async (deps: { onRowsSynced?: () => Promise<void> }) => {
      await deps.onRowsSynced?.()
      return OK_OUTCOME
    })

    const { result, log } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(log.warn).toHaveBeenCalledWith('retrieval.status_refresh_failed', {
      detail: 'recount hit a locked db',
    })
  })
})

describe('retrieval phase — diagnostics', () => {
  it('warns with the failure magnitude when the pass fails', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      retrievalFailure({ reason: 'call', detail: 'embedder session died', staleCount: 4 }),
    )

    const { log } = await runRetrievalPhase()

    expect(log.warn).toHaveBeenCalledWith('retrieval.embed_failed', {
      reason: 'call',
      staleCount: 4,
    })
  })

  it('trips on rows the blocking sync stage left stale', async () => {
    seedOpenStory()
    const counts = { entities: 0, lore: 3, happenings: 0, threads: 0, chapters: 0 }
    runRetrievalMock.mockResolvedValue(okOutcome({ staleCounts: counts }))

    const { result, log } = await runRetrievalPhase()

    expect(log.warn).toHaveBeenCalledWith('retrieval.stale_after_sync', counts)
    // A tripwire, not a gate: the turn still goes through.
    expect(result).toEqual({ status: 'completed' })
  })

  it('stays quiet when every count is zero', async () => {
    seedOpenStory()

    const { log } = await runRetrievalPhase()

    expect(log.warn).not.toHaveBeenCalled()
  })

  // A budget below its type's overhead drops every candidate as too large and
  // seats nothing, which no prompt and no error surface ever shows. Canon wants
  // it reported (retrieval.md → Budget-fill termination).
  it('warns when a type ranked candidates and seated none of them', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      okOutcome({
        bundleOverrides: {
          happenings: {
            selected: [],
            traces: [],
            funnel: {
              poolSize: 12,
              preFilteredSize: 12,
              selectedCount: 0,
              tokensUsed: 0,
              typeBudget: 3,
            },
            // Deliberately unpopulated: the diagnostic under test reads only `funnel`.
            pool: [],
          },
        },
      }),
    )

    const { result, log } = await runRetrievalPhase()

    expect(log.warn).toHaveBeenCalledWith('retrieval.type_seated_nothing', {
      type: 'happenings',
      poolSize: 12,
      typeBudget: 3,
    })
    // A signal, not a gate.
    expect(result).toEqual({ status: 'completed' })
  })

  // The empty-pool case is a cold start, not a misconfiguration.
  it('stays quiet when a type had no candidates to seat', async () => {
    seedOpenStory()

    const { log } = await runRetrievalPhase()

    expect(log.warn).not.toHaveBeenCalledWith(
      'retrieval.type_seated_nothing',
      expect.anything() as unknown as Record<string, unknown>,
    )
  })

  // AC7: the per-turn cost has to be observable against the PoC baseline, which
  // is a per-KNN-query figure — so the breakdown reaches the log, not just a total.
  it('logs the pass timing the run reported, breakdown included', async () => {
    seedOpenStory()
    const timings = { totalMs: 91, syncMs: 40, embedMs: 30, knnMs: 15, rankMs: 5 }
    runRetrievalMock.mockResolvedValue(okOutcome({ timings }))

    const { log } = await runRetrievalPhase()

    expect(log.debug).toHaveBeenCalledWith('retrieval.timing', timings)
  })

  it('logs no timing for a pass that failed before it produced one', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      retrievalFailure({ reason: 'call', detail: 'embedder session died', staleCount: 4 }),
    )

    const { log } = await runRetrievalPhase()

    expect(log.debug).not.toHaveBeenCalledWith('retrieval.timing', expect.anything())
  })

  it("summarizes every type's funnel and its top score", async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(okOutcome({ bundleOverrides: { lore: scoredBundle() } }))

    const { log } = await runRetrievalPhase()

    expect(log.debug).toHaveBeenCalledWith('retrieval.scores', {
      perType: {
        entities: EMPTY_SUMMARY,
        // Every number distinct, and the second trace scores lower than the
        // first: a summary reading the wrong funnel field or the wrong end of
        // the MMR order cannot agree with this by coincidence.
        lore: { pool: 9, kept: 7, selected: 3, tokens: 145, topScore: 0.87 },
        happenings: EMPTY_SUMMARY,
        threads: EMPTY_SUMMARY,
        chapters: EMPTY_SUMMARY,
      },
    })
  })

  it('logs no score summary for a pass that ranked nothing', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue(
      retrievalFailure({ reason: 'call', detail: 'embedder session died', staleCount: 4 }),
    )

    const { log } = await runRetrievalPhase()

    expect(log.debug).not.toHaveBeenCalledWith('retrieval.scores', expect.anything())
  })
})

describe('retrieval phase — RetrievalParams assembly', () => {
  it('carries the branch, the resolved model and its read dim', async () => {
    seedOpenStory({ entries: [entry(1, 'user_action', 'I draw the blade.', meta())] })

    await runRetrievalPhase()

    expect(lastParams()).toMatchObject({
      branchId: 'b1',
      modelId: 'Xenova/all-MiniLM-L6-v2',
      dim: 384,
    })
  })

  // Second model so neither field can be a constant that happens to match the
  // default story: both the id and the dim move together with the setting.
  it('follows the story to another catalog model and its dim family', async () => {
    seedOpenStory({ settings: { embedding_model_id: 'onnx-community/embeddinggemma-300m-ONNX' } })

    await runRetrievalPhase()

    expect(lastParams()).toMatchObject({
      modelId: 'onnx-community/embeddinggemma-300m-ONNX',
      dim: 768,
    })
  })

  // The sync scope is no longer passed alongside the branch — runRetrieval
  // derives it from this one field, so the pair cannot disagree. Pinning the
  // field is all that is left to get wrong here.
  it('names the branch being read exactly once', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    expect(lastParams().branchId).toBe('b1')
    expect(runRetrievalMock.mock.calls.at(-1)?.[0]).not.toHaveProperty('branchIds')
  })

  it("takes the budgets from the story's settings, not the code defaults", async () => {
    seedOpenStory({
      settings: {
        retrievalBudgets: { entities: 11, lore: 22, happenings: 33, threads: 44, chapters: 55 },
      },
    })

    await runRetrievalPhase()

    expect(lastParams().budgets).toEqual({
      entities: 11,
      lore: 22,
      happenings: 33,
      threads: 44,
      chapters: 55,
    })
  })

  it('takes the scene and location off the tail entry, narrowing characters by kind', async () => {
    seedOpenStory({
      entities: [
        entity('char_hero', 'character', 'Kael'),
        entity('item_blade', 'item', 'Blade'),
        entity('loc_keep', 'location', 'The Keep'),
      ],
      entries: [
        entry(
          1,
          'user_action',
          'I draw the blade.',
          meta({
            sceneEntities: ['char_hero', 'item_blade'],
            currentLocationId: 'loc_keep',
          }),
        ),
      ],
    })

    await runRetrievalPhase()

    const params = lastParams()
    // Positive control on both sides of the kind filter: the item is in the
    // scene set and out of the character set, so a filter that passed
    // everything (or nothing) fails here.
    expect(params.sceneEntityIds).toEqual(['char_hero', 'item_blade'])
    expect(params.sceneCharacterIds).toEqual(['char_hero'])
    expect(params.currentLocationId).toBe('loc_keep')
  })

  it('falls back to an empty scene when the branch has no entries at all', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    expect(lastParams()).toMatchObject({
      sceneEntityIds: [],
      sceneCharacterIds: [],
      currentLocationId: null,
    })
  })

  it("takes Q1 from the turn's own user action", async () => {
    seedOpenStory({
      entries: [
        entry(1, 'opening', 'The keep stands.', meta()),
        entry(2, 'user_action', 'I draw the blade.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.userAction).toBe('I draw the blade.')
  })

  it('leaves Q1 empty rather than reaching back when the tail is not a user action', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'user_action', 'I draw the blade.', meta()),
        entry(2, 'ai_reply', 'Steel sings.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.userAction).toBe('')
  })

  it('takes Q3 from the last ai_reply', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'opening', 'The keep stands.', meta()),
        entry(2, 'user_action', 'I look around.', meta()),
        entry(3, 'ai_reply', 'The hall is cold.', meta()),
        entry(4, 'user_action', 'I draw the blade.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.lastNarrativeContent).toBe('The hall is cold.')
  })

  // A trailing block survives sentence splitting as one pseudo-sentence
  // (splitSentences needs a terminator plus whitespace, which `</state>` never
  // gives) and outscores real narrative, spending a Q3 slot on tags and ids.
  it('strips a trailing block before Q3 extracts prose', async () => {
    seedOpenStory({
      entries: [
        entry(
          1,
          'ai_reply',
          'The hall is cold.\n<state><summary>Kara waits</summary></state>',
          meta(),
        ),
        entry(2, 'user_action', 'I draw the blade.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.lastNarrativeContent).toBe('The hall is cold.')
  })

  // Cold start (retrieval.md → Cold start): turn 1 has no ai_reply, and the
  // opening entry the wizard always commits is what Q3 extracts from. Selecting
  // ai_reply alone passes '' and silently drops Q3 on the first turn of every
  // story.
  it('takes Q3 from the opening entry on turn 1', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'opening', 'The keep stands against the ash.', meta()),
        entry(2, 'user_action', 'I draw the blade.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.lastNarrativeContent).toBe('The keep stands against the ash.')
  })

  it('leaves Q3 empty when the branch carries no narrative entry', async () => {
    seedOpenStory({ entries: [entry(1, 'user_action', 'I draw the blade.', meta())] })

    await runRetrievalPhase()

    expect(lastParams().query.lastNarrativeContent).toBe('')
  })

  it("enriches Q2 with the last narrative entry's piggyback summary", async () => {
    seedOpenStory({
      entries: [
        entry(1, 'ai_reply', 'Steel sings.', meta({ summary: 'Kael drew on the guard.' })),
        entry(2, 'user_action', 'I press the attack.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.piggybackSummary).toBe('Kael drew on the guard.')
  })

  it('leaves the Q2 summary line absent when the block never parsed', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'ai_reply', 'Steel sings.', meta()),
        entry(2, 'user_action', 'I press the attack.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.piggybackSummary).toBeNull()
  })

  it('leaves the Q2 era line absent — nothing writes branch_era_flips yet', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    expect(lastParams().query.eraName).toBeNull()
  })

  it('scans the composed prompt buffer for Layer-A suppression, not the whole branch', async () => {
    seedOpenStory({
      settings: { partialChapterBuffer: 2, protectedBuffer: 0 },
      entries: [
        entry(1, 'opening', 'ancient-prose', meta()),
        entry(2, 'ai_reply', 'older-prose', meta()),
        entry(3, 'ai_reply', 'recent-prose', meta()),
        entry(4, 'user_action', 'newest-prose', meta()),
      ],
    })

    await runRetrievalPhase()

    const { recentProse } = lastParams()
    expect(recentProse).toContain('recent-prose')
    expect(recentProse).toContain('newest-prose')
    // Positive control on the window: prose that slid out of the buffer must
    // not suppress a staged namesake forever.
    expect(recentProse).not.toContain('older-prose')
    expect(recentProse).not.toContain('ancient-prose')
  })

  // The suggestion block names entities the story has not told yet. Left in the
  // haystack, a staged entity named by a suggestion suppresses itself from the
  // pool on the turn it is introduced — the collision the rule exists to stop,
  // arriving through the mechanism meant to stop it.
  it('keeps a suggestions block out of the Layer-A haystack', async () => {
    seedOpenStory({
      entries: [
        entry(
          1,
          'ai_reply',
          'The hall is cold.\n<suggestions><item category="cat1">Ask Kara Vex for help</item></suggestions>',
          meta(),
        ),
      ],
    })

    await runRetrievalPhase()

    const { recentProse } = lastParams()
    expect(recentProse).toContain('The hall is cold.')
    expect(recentProse).not.toContain('Kara Vex')
  })
})

describe('retrieval phase — probe capture', () => {
  it('captures the pass the turn ran, keyed to the entry that drove it', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({
      probe_mode_active: true,
      retrievalBudgets: { entities: 11, lore: 22, happenings: 33, threads: 44, chapters: 55 },
    })
    runRetrievalMock.mockResolvedValue(retrievalSuccess({ queries: queryStack() }))

    await runRetrievalPhase(undefined, runInTransaction)

    const rows = captureRows(sqlite)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      branch_id: 'b1',
      // The tail, not the head: the capture is keyed to the row the pass ran
      // against.
      target_entry_id: 'entry_2',
      capture_mode: 'light',
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
      failure_reason: null,
    })
    const payload = payloadOf(rows[0])
    expect(payload.queries.map((q) => q.text)).toEqual([...QUERY_TEXTS])
    expect(payload.params.ranker).toEqual(RANKER_DEFAULTS)
    // Distinct per type, so a snapshot sourced from the code defaults cannot
    // agree with this.
    expect(payload.params.retrievalBudgets).toEqual({
      entities: 11,
      lore: 22,
      happenings: 33,
      threads: 44,
      chapters: 55,
    })
  })

  it('captures a failed pass with its reason and the queries it reached', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({ probe_mode_active: true })
    runRetrievalMock.mockResolvedValue(
      retrievalFailure(
        { reason: 'call', detail: 'provider unreachable', staleCount: null },
        { queries: queryStack() },
      ),
    )

    const { result } = await runRetrievalPhase(undefined, runInTransaction)

    expect(result).toMatchObject({ status: 'failed' })
    const rows = captureRows(sqlite)
    expect(rows).toHaveLength(1)
    expect(rows[0].failure_reason).toBe('call')
    // probe.md → Failed captures: the reached query text is the evidence a
    // failed capture exists to carry.
    expect(payloadOf(rows[0]).queries.map((q) => q.text)).toEqual([...QUERY_TEXTS])
  })

  it('writes nothing when the story gate is off', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({ probe_mode_active: false })

    const { result } = await runRetrievalPhase(undefined, runInTransaction)

    // Anchored on the result: an empty table also describes a pass that never
    // reached the capture at all.
    expect(result).toEqual({ status: 'completed' })
    expect(captureRows(sqlite)).toEqual([])
  })

  // Flipped mid-pass, not between passes: the embed is bounded at 300s, so a
  // user has a real window to toggle diagnostics while one is in flight, and a
  // gate resolved anywhere above the capture agrees with the value the pass
  // started under.
  it('honors an app gate switched off while the pass was in flight', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({ probe_mode_active: true })
    runRetrievalMock.mockImplementation(async () => {
      await setAppGate(db, false)
      return OK_OUTCOME
    })

    const { result } = await runRetrievalPhase(undefined, runInTransaction)

    expect(result).toEqual({ status: 'completed' })
    expect(captureRows(sqlite)).toEqual([])
  })

  it('honors an app gate switched on while the pass was in flight', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    seedProbeStory({ probe_mode_active: true })
    runRetrievalMock.mockImplementation(async () => {
      await setAppGate(db, true)
      return OK_OUTCOME
    })

    await runRetrievalPhase(undefined, runInTransaction)

    expect(captureRows(sqlite)).toHaveLength(1)
  })

  it('skips the capture, saying so, when the branch carries no entry to key it to', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedOpenStory({ settings: { probe_mode_active: true }, entries: [] })

    const { result, log } = await runRetrievalPhase(undefined, runInTransaction)

    expect(result).toEqual({ status: 'completed' })
    expect(captureRows(sqlite)).toEqual([])
    expect(log.debug).toHaveBeenCalledWith('retrieval.capture_skipped', {
      reason: 'branch has no entries',
    })
  })

  it('spends an armed deep capture on one pass and reverts to light', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({ probe_mode_active: true })
    armDeepCapture()

    await runRetrievalPhase(undefined, runInTransaction)
    await runRetrievalPhase(undefined, runInTransaction)

    expect(captureRows(sqlite).map((r) => r.capture_mode)).toEqual(['deep', 'light'])
  })

  // Arming is one screen away from the toggles, so a gated turn burning the arm
  // reads as "I armed it and got a light capture".
  it('keeps an armed deep capture over a turn the gates swallowed', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    const settings = seedProbeStory({ probe_mode_active: false })
    armDeepCapture()

    await runRetrievalPhase(undefined, runInTransaction)
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { ...settings, probe_mode_active: true },
    })
    await runRetrievalPhase(undefined, runInTransaction)

    expect(captureRows(sqlite).map((r) => r.capture_mode)).toEqual(['deep'])
  })

  // Same symptom as the gated turn above, from the other direction: the write is
  // attempted and fails, so the arm must survive rather than downgrade the next
  // turn to light.
  it('keeps an armed deep capture over a write that failed', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({ probe_mode_active: true })
    armDeepCapture()

    const failing = vi.fn().mockRejectedValue(new Error('disk full'))
    await runRetrievalPhase(undefined, failing)
    expect(captureRows(sqlite)).toHaveLength(0)

    await runRetrievalPhase(undefined, runInTransaction)

    expect(captureRows(sqlite).map((r) => r.capture_mode)).toEqual(['deep'])
  })

  it('captures nothing for a turn a cancel reached before the outcome landed', async () => {
    const { db, sqlite, runInTransaction } = await probeDb()
    await setAppGate(db, true)
    seedProbeStory({ probe_mode_active: true })
    const controller = new AbortController()
    runRetrievalMock.mockImplementation(async () => {
      controller.abort()
      return OK_OUTCOME
    })

    const { result } = await runRetrievalPhase(controller.signal, runInTransaction)

    expect(result).toEqual({ status: 'aborted' })
    expect(captureRows(sqlite)).toEqual([])
  })
})
