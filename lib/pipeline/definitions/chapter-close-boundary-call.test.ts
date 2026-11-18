import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { CallRetryError, generateStructured } from '@/lib/ai'
import type { CloseCandidate } from '@/lib/chapters'
import {
  STORY_SETTINGS_DEFAULTS,
  type OpenRegionRow,
  type StoryEntry,
  type Thread,
  type ThreadStatus,
} from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'
import { spyLogger } from '@/lib/diagnostics/__tests__/spy-logger'
import {
  appSettingsStore,
  currentStoryStore,
  entitiesStore,
  hydrateAppSettings,
  resetAllStores,
  threadsStore,
} from '@/lib/stores'

import { createPhaseDb, hydrateEntries, resetPhaseDb, type PhaseDb } from './__tests__/phase-db'
import { chapterBoundarySchema } from './chapter-boundary-schema'
import {
  readBoundaryInputs,
  requestChapterBoundary,
  type BoundaryCallInputs,
  type BoundaryCallOutcome,
} from './chapter-close-boundary-call'
import type { PhaseContext, PhaseEmittedEvent } from '../types'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

const DEFINITION = {
  mode: 'adventure' as const,
  leadEntityId: null,
  narration: 'second' as const,
  genre: { label: 'Fantasy', promptBody: '' },
  tone: { label: 'Wry', promptBody: '' },
  setting: 'A river country under a new toll.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

const PROVIDER = {
  id: 'prov-1',
  type: 'openai-compatible' as const,
  displayName: 'Local',
  apiKey: 'k',
  endpoint: 'http://x/v1',
  favoriteModelIds: [] as string[],
}

// Threshold 400: candidates hold 200–600 tokens. Running totals: e3 240, e5 400, e7 580, e9 700,
// e11 800. e9 is past the bound and e11 is the newest reply, so the candidates are e3, e5 and e7.
const THRESHOLD = 400
const SERIES: readonly OpenRegionRow[] = [
  { id: 'e1', kind: 'opening', position: 1, tokens: 100 },
  { id: 'e2', kind: 'user_action', position: 2, tokens: 20 },
  { id: 'e3', kind: 'ai_reply', position: 3, tokens: 120 },
  { id: 'e4', kind: 'user_action', position: 4, tokens: 20 },
  { id: 'e5', kind: 'ai_reply', position: 5, tokens: 140 },
  { id: 'e6', kind: 'user_action', position: 6, tokens: 20 },
  { id: 'e7', kind: 'ai_reply', position: 7, tokens: 160 },
  { id: 'e8', kind: 'user_action', position: 8, tokens: 20 },
  { id: 'e9', kind: 'ai_reply', position: 9, tokens: 100 },
  { id: 'e10', kind: 'user_action', position: 10, tokens: 20 },
  { id: 'e11', kind: 'ai_reply', position: 11, tokens: 80 },
]
const REGION_TOKENS = 800

const CANDIDATES: readonly CloseCandidate<OpenRegionRow>[] = [
  { ...SERIES[2]!, tokensThrough: 240 },
  { ...SERIES[4]!, tokensThrough: 400 },
  { ...SERIES[6]!, tokensThrough: 580 },
]

// e5 still carries the trailing block a pre-strip row kept; promptProse drops it.
const PROSE: Record<string, string> = {
  e3: 'The ferry bumps the far jetty. Tobin ties off without a word. Above you, the toll house window goes dark.',
  e5: 'The guard lifts his lantern to the seal. For a long moment he weighs it. Then he steps aside and waves you through.\n<state><summary>The guard lets Wren pass</summary></state>',
  e7: 'The road east climbs out of the mist. Behind you a door bangs shut. The milestone reads Low Ashby, nine miles.',
  e9: 'The ferryman counts the coins twice and pockets them.',
  e11: 'Wren reads the letter again by the milestone.',
}

const ROWS: StoryEntry[] = SERIES.map((row) => ({
  id: row.id,
  branchId: 'b1',
  position: row.position,
  kind: row.kind,
  content: PROSE[row.id] ?? `I keep walking, step ${row.position}.`,
  contentTokens: row.tokens,
  chapterId: null,
  metadata: null,
  createdAt: row.position,
}))

const PARSE_FIRST = {
  tier: 'parse',
  detail: 'end_entry_id: name one of t1, t2, t3',
  attempt: 0,
} satisfies CallRetryError
const PARSE_LAST = { ...PARSE_FIRST, attempt: 1 } satisfies CallRetryError
const CUT_OFF = {
  tier: 'reply-cut-off',
  cause: 'max-output',
  outputTokens: 8000,
  reasoningTokens: null,
  maxOutput: 8000,
  window: null,
  providerId: PROVIDER.id,
  modelId: 'm',
  fromOverride: false,
} satisfies CallRetryError
const NETWORK = {
  tier: 'provider',
  reason: 'network',
  detail: 'ECONNRESET',
} satisfies CallRetryError

function thread(id: string, title: string, status: ThreadStatus, branchId = 'b1'): Thread {
  return {
    id,
    branchId,
    title,
    description: null,
    category: null,
    icon: null,
    status,
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function phaseCtx(
  abortSignal: AbortSignal = new AbortController().signal,
  log: Logger = spyLogger(),
): PhaseContext {
  return {
    actionId: 'act_close',
    abortSignal,
    intermediates: {},
    log,
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
  }
}

function inputs(): BoundaryCallInputs {
  const read = readBoundaryInputs(phaseCtx())
  if ('status' in read) throw new Error(`readBoundaryInputs refused: ${read.error.kind}`)
  return read
}

async function drain(ctx: PhaseContext = phaseCtx()) {
  const gen = requestChapterBoundary(ctx, SERIES, CANDIDATES, inputs())
  const events: PhaseEmittedEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, outcome: next.value }
    events.push(next.value)
  }
}

const answer = (endEntryId: string, rationale = 'The guard lets her through.') =>
  generateStructuredMock.mockResolvedValue({
    status: 'ok',
    value: { end_entry_id: endEntryId, rationale },
    recoverable: [],
  } as never)

let phaseDb: PhaseDb

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

beforeEach(async () => {
  generateStructuredMock.mockReset()
  resetPhaseDb(phaseDb)
  resetAllStores()
  const settings = await hydrateAppSettings(async () => ({
    providers: [PROVIDER],
    profiles: [
      {
        id: 'prof-lore',
        kind: 'agent' as const,
        name: 'Lore',
        modelRef: { providerId: PROVIDER.id, modelId: 'm' },
      },
    ],
    assignments: { 'lore-mgmt': 'prof-lore' },
    defaultProviderId: PROVIDER.id,
    diagnostics: { enabled: false, debug_level_enabled: false },
  }))
  expect(settings).toEqual({ status: 'ok' })
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: DEFINITION,
    settings: { ...STORY_SETTINGS_DEFAULTS, chapterTokenThreshold: THRESHOLD },
  })
  entitiesStore.hydrate('b1', [])
  threadsStore.hydrate('b1', [
    thread('thr_1', 'Find the\nheir', 'active'),
    thread('thr_2', 'The ford crossing', 'pending'),
    thread('thr_3', 'The lost map', 'resolved'),
  ])
  hydrateEntries(phaseDb, 'b1', ROWS)
})

describe('readBoundaryInputs', () => {
  it("reads the threshold, the branch's active threads and lore-mgmt's config", () => {
    const settings = appSettingsStore.getAppSettings()
    expect(readBoundaryInputs(phaseCtx())).toEqual({
      threshold: 400,
      activeThreads: [{ title: 'Find the\nheir' }],
      modelConfig: {
        providers: settings.providers,
        profiles: settings.profiles,
        assignments: settings.assignments,
        storyModels: {},
      },
    })
  })

  it("leaves out another branch's active thread", () => {
    threadsStore.hydrate('b1', [
      thread('thr_1', 'Find the heir', 'active'),
      thread('thr_x', 'Elsewhere entirely', 'active', 'b2'),
    ])
    expect(readBoundaryInputs(phaseCtx())).toMatchObject({
      activeThreads: [{ title: 'Find the heir' }],
    })
  })

  it("carries the story's model overrides into the config", () => {
    const models = { 'lore-mgmt': { providerId: PROVIDER.id, modelId: 'big' } }
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: DEFINITION,
      settings: { ...STORY_SETTINGS_DEFAULTS, chapterTokenThreshold: THRESHOLD, models },
    })
    expect(readBoundaryInputs(phaseCtx())).toMatchObject({ modelConfig: { storyModels: models } })
  })

  it.each([
    { name: 'no story is open', unload: () => currentStoryStore.clear() },
    { name: 'the stores hold another branch', unload: () => entitiesStore.hydrate('b2', []) },
  ])('fails when $name', ({ unload }) => {
    unload()
    expect(readBoundaryInputs(phaseCtx())).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    })
  })
})

describe('requestChapterBoundary — the call', () => {
  it('asks lore-mgmt once, under the 8k default, with a schema refusing any turn but a candidate', async () => {
    answer('t2')
    await drain()

    expect(generateStructuredMock).toHaveBeenCalledOnce()
    const [target, , schema, config, , options] = generateStructuredMock.mock.calls[0]!
    expect(target).toBe('lore-mgmt')
    expect(options).toEqual({ actionId: 'act_close', defaultMaxOutput: 8000 })
    expect(config).toMatchObject({ assignments: { 'lore-mgmt': 'prof-lore' }, storyModels: {} })
    // AC3: the block the mock matches on is the plain schema's.
    expect(z.toJSONSchema(schema)).toEqual(z.toJSONSchema(chapterBoundarySchema))
    for (const turn of ['t1', 't2', 't3'])
      expect(schema.safeParse({ end_entry_id: turn, rationale: 'x' }).success).toBe(true)
    expect(schema.safeParse({ end_entry_id: 't4', rationale: 'x' }).success).toBe(false)
  })

  it('prompts with each candidate by its first and last sentence, in position order, in the user half', async () => {
    answer('t2')
    await drain()

    const { system, user } = generateStructuredMock.mock.calls[0]![1]
    const shown = [
      'The ferry bumps the far jetty.',
      'Above you, the toll house window goes dark.',
      'The guard lifts his lantern to the seal.',
      'Then he steps aside and waves you through.',
      'The road east climbs out of the mist.',
      'The milestone reads Low Ashby, nine miles.',
    ]
    const at = shown.map((sentence) => user.indexOf(sentence))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    for (const turn of ['t1', 't2', 't3']) expect(user).toContain(turn)
    // Middle sentences, markup, and every row that isn't a candidate stay out.
    expect(user).not.toContain('Tobin ties off without a word.')
    expect(user).not.toContain('For a long moment he weighs it.')
    expect(user).not.toContain('<state>')
    expect(user).not.toContain('The ferryman counts the coins')
    expect(user).not.toContain('Wren reads the letter again')
    expect(user).not.toContain('I keep walking')
    expect(user).not.toContain('t4')
    for (const sentence of shown) expect(system).not.toContain(sentence)
  })

  it("prompts with the whole region's tokens, the threshold and the active threads on one line", async () => {
    answer('t2')
    await drain()

    const { system, user } = generateStructuredMock.mock.calls[0]![1]
    expect(user).toContain(String(REGION_TOKENS))
    expect(user).toContain(String(THRESHOLD))
    expect(user).toContain('Find the heir')
    expect(user).not.toContain('Find the\nheir')
    expect(user).not.toContain('The ford crossing')
    expect(user).not.toContain('The lost map')
    expect(system).not.toContain('Find the heir')
  })

  // Entry ids are unique per branch only, so a fork can hold a candidate's id with its own prose.
  it("reads its own branch's prose for a candidate id another branch shares", async () => {
    phaseDb.sqlite
      .prepare(
        `INSERT INTO story_entries
           (id, branch_id, position, kind, content, content_tokens, chapter_id, metadata, created_at)
         VALUES ('e5', 'b2', 5, 'ai_reply', 'The fork rewrote this turn entirely.', 140, NULL, NULL, 5)`,
      )
      .run()
    answer('t2')
    await drain()

    const { user } = generateStructuredMock.mock.calls[0]![1]
    expect(user).toContain('The guard lifts his lantern to the seal.')
    expect(user).not.toContain('The fork rewrote this turn')
  })
})

describe('requestChapterBoundary — outcomes', () => {
  it.each<{ name: string; result: unknown; outcome: BoundaryCallOutcome }>([
    {
      name: 'a valid turn picks its candidate',
      result: { status: 'ok', value: { end_entry_id: 't2', rationale: 'x' }, recoverable: [] },
      outcome: { status: 'picked', endEntryId: 'e5' },
    },
    {
      name: 'a turn no candidate holds, which a mocked parse let through, ends on the latest candidate',
      result: { status: 'ok', value: { end_entry_id: 't9', rationale: 'x' }, recoverable: [] },
      outcome: { status: 'unusable', endEntryId: 'e7', tier: 'parse' },
    },
    {
      name: 'a reply unparsed after its retry ends on the latest candidate',
      result: { status: 'failed', error: PARSE_LAST, recoverable: [PARSE_FIRST] },
      outcome: { status: 'unusable', endEntryId: 'e7', tier: 'parse' },
    },
    {
      name: 'a cut-off reply ends on the latest candidate',
      result: { status: 'failed', error: CUT_OFF, recoverable: [] },
      outcome: { status: 'unusable', endEntryId: 'e7', tier: 'reply-cut-off' },
    },
    {
      name: 'a provider failure fails',
      result: { status: 'failed', error: NETWORK, recoverable: [] },
      outcome: {
        status: 'failed',
        error: { kind: 'provider', reason: 'network', detail: 'ECONNRESET' },
      },
    },
    {
      name: 'an unassigned model fails as a config fault',
      result: { status: 'not-configured', kind: 'no-profile-assigned' },
      outcome: {
        status: 'failed',
        error: {
          kind: 'config-resolver',
          failure: 'no-profile-assigned',
          target: 'lore-mgmt',
          phaseName: 'boundary',
        },
      },
    },
  ])('$name', async ({ result, outcome }) => {
    generateStructuredMock.mockResolvedValue(result as never)
    expect((await drain()).outcome).toEqual(outcome)
  })

  // An expiry aborts the call as a cancel does, but it is the provider's fault: no fallback.
  it('fails a call that outlives its bound as a provider timeout', async () => {
    generateStructuredMock.mockImplementation(
      (...args: unknown[]) =>
        new Promise((resolve) => {
          const signal = args[4] as AbortSignal
          signal.addEventListener('abort', () => resolve({ status: 'aborted', recoverable: [] }))
        }) as never,
    )
    vi.useFakeTimers()
    try {
      const pending = drain()
      // Past the ten-minute default bound, so a wrong bound still expires and the detail names it.
      await vi.advanceTimersByTimeAsync(1_000_000)
      expect((await pending).outcome).toEqual({
        status: 'failed',
        error: {
          kind: 'provider',
          reason: 'timeout',
          detail: 'lore-mgmt: timeout after 600000ms',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns aborted for a cancel', async () => {
    const controller = new AbortController()
    generateStructuredMock.mockImplementation(async () => {
      controller.abort()
      return { status: 'aborted', recoverable: [] } as never
    })
    expect((await drain(phaseCtx(controller.signal))).outcome).toEqual({ status: 'aborted' })
  })

  it('returns aborted when the run is cancelled as a valid reply lands, logging no pick', async () => {
    const controller = new AbortController()
    const log = spyLogger()
    generateStructuredMock.mockImplementation(async () => {
      controller.abort()
      return {
        status: 'ok',
        value: { end_entry_id: 't2', rationale: 'x' },
        recoverable: [],
      } as never
    })
    expect((await drain(phaseCtx(controller.signal, log))).outcome).toEqual({ status: 'aborted' })
    expect(log.debug).not.toHaveBeenCalled()
  })

  it('yields an event per retried attempt', async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: { end_entry_id: 't2', rationale: 'x' },
      recoverable: [PARSE_FIRST],
    } as never)
    const { events } = await drain()
    expect(events).toEqual([
      { type: 'recoverable_error', error: { kind: 'phase-logic', detail: PARSE_FIRST.detail } },
    ])
  })

  it('logs a pick at debug with its turn and rationale', async () => {
    answer('t2', 'The guard waving her through closes the crossing.')
    const log = spyLogger()
    await drain(phaseCtx(undefined, log))
    expect(log.debug).toHaveBeenCalledWith('memory.close_boundary_picked', {
      endEntryId: 'e5',
      turn: 't2',
      rationale: 'The guard waving her through closes the crossing.',
      candidates: 3,
    })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('warns of a fallback with its tier and the entry it ends on', async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'failed',
      error: CUT_OFF,
      recoverable: [],
    } as never)
    const log = spyLogger()
    await drain(phaseCtx(undefined, log))
    expect(log.warn).toHaveBeenCalledWith('memory.close_boundary_fallback', {
      tier: 'reply-cut-off',
      endEntryId: 'e7',
    })
    expect(log.debug).not.toHaveBeenCalled()
  })
})
