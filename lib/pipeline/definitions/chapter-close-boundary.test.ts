import { APICallError } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { getModel } from '@/lib/ai/model'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, type StoryEntry, type StorySettings } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { spyLogger } from '@/lib/diagnostics/__tests__/spy-logger'
import {
  currentStoryStore,
  entitiesStore,
  generationStore,
  hydrateAppSettings,
  resetAllStores,
  threadsStore,
  type RunState,
} from '@/lib/stores'

import { openCloseFixture } from './__tests__/close-fixture'
import { createPhaseDb, hydrateEntries, resetPhaseDb, type PhaseDb } from './__tests__/phase-db'
import { chapterBoundarySchema, refineBoundaryReply } from './chapter-boundary-schema'
import { closeBoundaryPhase } from './chapter-close-boundary'
import { closeRangeOf } from './close-intermediates'
import { CLOSE_PHASE } from './intermediates'
import type { PhaseContext } from '../types'

// The provider is the only fake: the real call, bound, retry and parse run between it and phase.
vi.mock('@/lib/ai/model', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getModel: vi.fn(),
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

async function wireLore(profile: { maxOutput?: number } = {}): Promise<void> {
  const result = await hydrateAppSettings(async () => ({
    providers: [PROVIDER],
    profiles: [
      {
        id: 'prof-lore',
        kind: 'agent' as const,
        name: 'Lore',
        modelRef: { providerId: PROVIDER.id, modelId: 'm' },
        ...profile,
      },
    ],
    assignments: { 'lore-mgmt': 'prof-lore' },
    defaultProviderId: PROVIDER.id,
    diagnostics: { enabled: false, debug_level_enabled: false },
  }))
  expect(result).toEqual({ status: 'ok' })
}

// What readBoundaryInputs needs: the open story on b1, and the working-set stores holding it.
function openBranch(settings: Partial<StorySettings> = {}): void {
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: DEFINITION,
    settings: { ...STORY_SETTINGS_DEFAULTS, ...settings },
  })
  entitiesStore.hydrate('b1', [])
  threadsStore.hydrate('b1', [])
}

let phaseDb: PhaseDb

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

beforeEach(async () => {
  vi.mocked(getModel).mockReset()
  resetPhaseDb(phaseDb)
  resetAllStores()
  await wireLore()
  openBranch()
})

function row(
  id: string,
  position: number,
  kind: StoryEntry['kind'],
  chapterId: string | null = null,
): StoryEntry {
  return {
    id,
    branchId: 'b1',
    position,
    kind,
    content: `The crossing, part ${position}: reeds, black water and a lantern on the far bank.`,
    contentTokens: null,
    chapterId,
    metadata: null,
    createdAt: position,
  }
}

// A first chapter still open; the system row is outside the open region. With no pick the fallback
// ends on e5, the latest reply before the head e8.
const FIRST_CHAPTER_OPEN = [
  row('e1', 1, 'opening'),
  row('e2', 2, 'user_action'),
  row('e3', 3, 'ai_reply'),
  row('e4', 4, 'user_action'),
  row('e5', 5, 'ai_reply'),
  row('s6', 6, 'system'),
  row('e7', 7, 'user_action'),
  row('e8', 8, 'ai_reply'),
]

// The branch's first chapter closed at e3, so e1..e3 carry its stamp.
const AFTER_A_CHAPTER = [
  row('e1', 1, 'opening', 'chap_first'),
  row('e2', 2, 'user_action', 'chap_first'),
  row('e3', 3, 'ai_reply', 'chap_first'),
  row('e4', 4, 'user_action'),
  row('e5', 5, 'ai_reply'),
]

// An open region with no reply to end on.
const NO_REPLY = [row('e1', 1, 'opening'), row('e2', 2, 'user_action')]

function phaseCtx(over: Partial<PhaseContext> = {}): PhaseContext {
  return {
    actionId: 'act_close',
    abortSignal: new AbortController().signal,
    intermediates: {},
    log: makeLogger('act_close'),
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
    ...over,
  }
}

async function drain(ctx: PhaseContext) {
  const gen = closeBoundaryPhase(ctx)
  const events: unknown[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const refused = {
  status: 'failed',
  error: {
    kind: 'phase-logic',
    phaseName: CLOSE_PHASE.boundary,
    detail: expect.stringContaining('chapter-close:'),
  },
}

const chapterRows = (): number =>
  (phaseDb.sqlite.prepare('SELECT COUNT(*) AS n FROM chapters').get() as { n: number }).n

// Records a pass deferred on b1, as a head reversal or the pill's Cancel does.
function deferPassOnB1(): void {
  const interrupted: RunState = {
    runId: 'run_pass',
    kind: PERIODIC_CLASSIFIER_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    beforeTurn: false,
    actionId: 'act_pass',
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
  generationStore.startRun(interrupted)
  expect(generationStore.abortRun(interrupted.runId, 'aborted')).toBe('pass')
}

const pickOn = (branchId: string) => generationStore.getTxState().pendingClose.get(branchId)

async function expectRefused(): Promise<void> {
  const ctx = phaseCtx()
  const { events, result } = await drain(ctx)
  expect(result).toEqual(refused)
  expect(events).toEqual([])
  expect(ctx.intermediates).toEqual({})
}

async function expectEndsOn(
  ctx: PhaseContext,
  range: { startEntryId: string; endEntryId: string },
): Promise<void> {
  const { events, result } = await drain(ctx)
  expect(result).toEqual({ status: 'completed' })
  expect(events).toEqual([])
  expect(closeRangeOf(ctx.intermediates)).toEqual({
    chapterId: expect.stringMatching(/^chap_[0-9a-f-]{36}$/),
    ...range,
  })
}

describe('closeBoundaryPhase with a pick', () => {
  // Neither is the fallback's e5; e8 is the head, which a manual close may end on.
  it.each(['e3', 'e8'])('ends on the picked %s', async (endEntryId) => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId })
  })

  it('reads no store input, so it ends on a pick with no story open', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    currentStoryStore.clear()
    generationStore.setPendingClose('b1', { endEntryId: 'e3' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e3' })
  })

  it('writes nothing, and leaves the pick for the commit to drop', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(chapterRows()).toBe(0)
    // finishRun drops it at the commit, not this phase.
    expect(pickOn('b1')).toEqual({ endEntryId: 'e5' })
  })

  it("starts the range after the last chapter's stamps", async () => {
    hydrateEntries(phaseDb, 'b1', AFTER_A_CHAPTER)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e4', endEntryId: 'e5' })
  })

  it('mints a new chapter id for each run', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    const first = phaseCtx()
    const second = phaseCtx()
    await drain(first)
    await drain(second)
    const idOf = (ctx: PhaseContext) => closeRangeOf(ctx.intermediates)?.chapterId
    expect(idOf(first)).not.toBe(idOf(second))
  })

  // C10: a system entry hard-deletes with no delta, and a held entry is another chapter's.
  it.each([
    { name: 'a system entry', rows: FIRST_CHAPTER_OPEN, endEntryId: 's6' },
    { name: 'an entry a chapter already holds', rows: AFTER_A_CHAPTER, endEntryId: 'e3' },
    { name: 'an entry the branch does not have', rows: FIRST_CHAPTER_OPEN, endEntryId: 'e99' },
  ])(
    'drops a pick on $name and fails: it is not in the open region',
    async ({ rows, endEntryId }) => {
      hydrateEntries(phaseDb, 'b1', rows)
      generationStore.setPendingClose('b1', { endEntryId })
      await expectRefused()
      expect(pickOn('b1')).toBeUndefined()
    },
  )

  // C10: the opening is the rollback floor, and a user_action splits a turn.
  it.each([
    { kind: 'user_action', endEntryId: 'e4' },
    { kind: 'opening', endEntryId: 'e1' },
  ])(
    'drops a pick on an open-region $kind and fails, through canEndChapter',
    async ({ endEntryId }) => {
      hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
      generationStore.setPendingClose('b1', { endEntryId })
      await expectRefused()
      expect(pickOn('b1')).toBeUndefined()
    },
  )

  it('leaves a deferred pass alone when it drops a stale pick', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    deferPassOnB1()
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    generationStore.setPendingClose('b1', { endEntryId: 'e99' })
    await expectRefused()
    expect(pickOn('b1')).toBeUndefined()
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
  })

  it('checks the pick standing after its read, so a pick replaced during it is kept', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e99' })
    let replaced = false
    const db = new Proxy(phaseDb.db, {
      get(target, prop, receiver) {
        if (prop === 'select' && !replaced) {
          replaced = true
          generationStore.setPendingClose('b1', { endEntryId: 'e5' })
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    await expectEndsOn(phaseCtx({ db }), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(replaced).toBe(true)
    expect(pickOn('b1')).toEqual({ endEntryId: 'e5' })
  })

  it("drops only its own branch's stale pick", async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e99' })
    generationStore.setPendingClose('b2', { endEntryId: 'e5' })
    await expectRefused()
    expect(pickOn('b1')).toBeUndefined()
    expect(pickOn('b2')).toEqual({ endEntryId: 'e5' })
  })
})

describe('closeBoundaryPhase with no pick', () => {
  // The region counts no tokens, so no row reaches half a threshold: no candidate, no call.
  it('ends on the latest reply before the head, with no model call', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(chapterRows()).toBe(0)
    expect(getModel).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'no story is open', unload: () => currentStoryStore.clear() },
    { name: 'the stores hold another branch', unload: () => entitiesStore.hydrate('b2', []) },
  ])('fails when $name, since it reads the threshold there', async ({ unload }) => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    unload()
    const ctx = phaseCtx()
    const { events, result } = await drain(ctx)
    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    })
    expect(events).toEqual([])
    expect(ctx.intermediates).toEqual({})
  })

  // A failed Send's system entry sits at the tail when the next Send runs the owed close.
  it("takes the open region's head, not a system row after it", async () => {
    hydrateEntries(phaseDb, 'b1', [...FIRST_CHAPTER_OPEN.slice(0, 5), row('s6', 6, 'system')])
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e3' })
  })

  it('ends on the head when no reply comes before it', async () => {
    hydrateEntries(phaseDb, 'b1', AFTER_A_CHAPTER)
    await expectEndsOn(phaseCtx(), { startEntryId: 'e4', endEntryId: 'e5' })
  })

  it("reads its own branch's record, not another's", async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b2', { endEntryId: 'e3' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(pickOn('b2')).toEqual({ endEntryId: 'e3' })
  })

  // closeOwed owes no close here (C10); the phase still refuses rather than end on a non-reply.
  it.each([
    { name: 'a region with no reply', rows: NO_REPLY },
    { name: 'an empty region', rows: [] as StoryEntry[] },
  ])('refuses $name', async ({ rows }) => {
    hydrateEntries(phaseDb, 'b1', rows)
    await expectRefused()
  })

  // A region written through the action layer, not hydrated as rows, as a chained close meets it.
  it('ends a written region on the reply before the newest', async () => {
    const f = await openCloseFixture()
    const ctx = phaseCtx({ db: f.ctx.db, storyId: f.storyId, branchId: f.branchId })
    await expectEndsOn(ctx, { startEntryId: f.entries[0]!.id, endEntryId: f.replyIds.at(-2)! })
  })
})

// Threshold 400, window 200–600. Totals: e3 240, e5 400, e7 580, e9 700, e11 800. Candidates e3, e5,
// e7 (t1-t3): e9 is past the bound, e11 the newest. fallbackChapterEnd would end on e9, not e7.
const THRESHOLD = 400

function sized(id: string, position: number, kind: StoryEntry['kind'], tokens: number): StoryEntry {
  return { ...row(id, position, kind), contentTokens: tokens }
}

const CANDIDATE_REGION = [
  sized('e1', 1, 'opening', 100),
  sized('e2', 2, 'user_action', 20),
  sized('e3', 3, 'ai_reply', 120),
  sized('e4', 4, 'user_action', 20),
  sized('e5', 5, 'ai_reply', 140),
  sized('e6', 6, 'user_action', 20),
  sized('e7', 7, 'ai_reply', 160),
  sized('e8', 8, 'user_action', 20),
  sized('e9', 9, 'ai_reply', 100),
  sized('e10', 10, 'user_action', 20),
  sized('e11', 11, 'ai_reply', 80),
]

// e5 reaches the threshold exactly but is the newest reply, so e3 is the only candidate.
const NEWEST_IN_RANGE = [
  sized('e1', 1, 'opening', 100),
  sized('e2', 2, 'user_action', 20),
  sized('e3', 3, 'ai_reply', 120),
  sized('e4', 4, 'user_action', 20),
  { ...sized('e5', 5, 'ai_reply', 140), content: 'The newest reply ends at the toll house.' },
]

// Totals e3 240, e5 400, e7 480: e7 sits inside the bounds but is the newest, so e3 and e5 (t1, t2).
const TWO_BEFORE_NEWEST = [
  ...NEWEST_IN_RANGE.slice(0, 4),
  sized('e5', 5, 'ai_reply', 140),
  sized('e6', 6, 'user_action', 20),
  { ...sized('e7', 7, 'ai_reply', 60), content: 'The newest reply ends at the toll house.' },
]

const USAGE = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 24, text: 24, reasoning: undefined },
}

type Scripted = { text: string; cutOff?: true } | { error: unknown }

// Answers each call with the next scripted reply; a call past the script fails the test.
function scriptModel(replies: Scripted[]): MockLanguageModelV3 {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      const next = replies.shift()
      if (next == null) throw new Error('boundary test: the model was called past its script')
      if ('error' in next) throw next.error
      return {
        content: [{ type: 'text' as const, text: next.text }],
        finishReason:
          next.cutOff === true
            ? { unified: 'length' as const, raw: 'length' }
            : { unified: 'stop' as const, raw: 'stop' },
        usage: USAGE,
        warnings: [],
      }
    },
  })
  vi.mocked(getModel).mockReturnValue(model as never)
  return model
}

const RATIONALE = 'The guard waving her through closes the crossing.'
const reply = (turn: string): string => JSON.stringify({ end_entry_id: turn, rationale: RATIONALE })

// The text of the request's last user message, the prompt's user half with the reply contract.
function sentUser(model: MockLanguageModelV3): string {
  const message = model.doGenerateCalls[0]?.prompt.filter((m) => m.role === 'user').at(-1)
  if (message?.role !== 'user') throw new Error('the request carried no user message')
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

describe('closeBoundaryPhase over candidates', () => {
  beforeEach(() => {
    openBranch({ chapterTokenThreshold: THRESHOLD })
    hydrateEntries(phaseDb, 'b1', CANDIDATE_REGION)
  })

  it('ends on a standing pick with no model call', async () => {
    scriptModel([])
    generationStore.setPendingClose('b1', { endEntryId: 'e9' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e9' })
    expect(getModel).not.toHaveBeenCalled()
  })

  it("ends on the model's pick, after one call, and logs it", async () => {
    const model = scriptModel([{ text: reply('t2') }])
    const log = spyLogger()
    await expectEndsOn(phaseCtx({ log }), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(log.debug).toHaveBeenCalledWith('memory.close_boundary_picked', {
      endEntryId: 'e5',
      turn: 't2',
      rationale: RATIONALE,
      candidates: 3,
    })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('ends on the latest candidate after a reply naming a non-candidate twice', async () => {
    const model = scriptModel([{ text: reply('t9') }, { text: reply('t9') }])
    const log = spyLogger()
    const ctx = phaseCtx({ log })
    const { events, result } = await drain(ctx)
    expect(result).toEqual({ status: 'completed' })
    expect(closeRangeOf(ctx.intermediates)).toMatchObject({ startEntryId: 'e1', endEntryId: 'e7' })
    expect(model.doGenerateCalls).toHaveLength(2)
    // The first attempt's parse failure, retried on the same prompt.
    expect(events).toEqual([
      { type: 'recoverable_error', error: { kind: 'phase-logic', detail: expect.any(String) } },
    ])
    expect(log.warn).toHaveBeenCalledWith('memory.close_boundary_fallback', {
      tier: 'parse',
      endEntryId: 'e7',
      detail: expect.stringContaining('end_entry_id must be one of the listed turns: t1, t2, t3'),
    })
  })

  it('ends on the latest candidate after one cut-off reply', async () => {
    const model = scriptModel([
      { text: '{"end_entry_id": "t2", "rationale": "The gua', cutOff: true },
    ])
    const log = spyLogger()
    const ctx = phaseCtx({ log })
    const { events, result } = await drain(ctx)
    expect(result).toEqual({ status: 'completed' })
    expect(closeRangeOf(ctx.intermediates)).toMatchObject({ startEntryId: 'e1', endEntryId: 'e7' })
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(events).toEqual([])
    expect(log.warn).toHaveBeenCalledWith('memory.close_boundary_fallback', {
      tier: 'reply-cut-off',
      endEntryId: 'e7',
      detail: 'reply cut off (unknown): 24 output tokens; model m on provider prov-1',
    })
  })

  it('fails on a provider failure and parks no range', async () => {
    const model = scriptModel([
      {
        error: new APICallError({
          message: 'unauthorized',
          url: 'http://x/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 401,
        }),
      },
    ])
    const ctx = phaseCtx()
    const { result } = await drain(ctx)
    expect(result).toMatchObject({ status: 'failed', error: { kind: 'provider', reason: 'auth' } })
    expect(ctx.intermediates).toEqual({})
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('returns aborted for a cancelled run, sending nothing and parking no range', async () => {
    const model = scriptModel([{ text: reply('t2') }])
    const controller = new AbortController()
    controller.abort()
    const ctx = phaseCtx({ abortSignal: controller.signal })
    const { result } = await drain(ctx)
    expect(result).toEqual({ status: 'aborted' })
    expect(ctx.intermediates).toEqual({})
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it.each([
    {
      name: 'sends 16384 when neither the profile nor an override sets a max output',
      profile: {},
      override: undefined,
      sent: 16384,
    },
    {
      name: "sends the profile's max output",
      profile: { maxOutput: 3000 },
      override: undefined,
      sent: 3000,
    },
    {
      name: "sends the story override's max output",
      profile: { maxOutput: 3000 },
      override: { providerId: PROVIDER.id, modelId: 'big', maxOutput: 2500 },
      sent: 2500,
    },
    {
      name: 'sends 16384 under an override that sets none, though the profile does',
      profile: { maxOutput: 3000 },
      override: { providerId: PROVIDER.id, modelId: 'big' },
      sent: 16384,
    },
  ])('$name', async ({ profile, override, sent }) => {
    await wireLore(profile)
    openBranch({
      chapterTokenThreshold: THRESHOLD,
      ...(override === undefined ? {} : { models: { 'lore-mgmt': override } }),
    })
    const model = scriptModel([{ text: reply('t2') }])
    await drain(phaseCtx())
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(sent)
  })
})

describe('closeBoundaryPhase — the newest reply', () => {
  // Every usable answer would name the one candidate, so a call could only fail the close.
  it('leaves one candidate before it, ending there with no model call', async () => {
    openBranch({ chapterTokenThreshold: THRESHOLD })
    hydrateEntries(phaseDb, 'b1', NEWEST_IN_RANGE)
    scriptModel([])
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e3' })
    expect(getModel).not.toHaveBeenCalled()
  })

  it('is never offered beside two candidates, which make the call', async () => {
    openBranch({ chapterTokenThreshold: THRESHOLD })
    hydrateEntries(phaseDb, 'b1', TWO_BEFORE_NEWEST)
    const model = scriptModel([{ text: reply('t1') }])
    const log = spyLogger()
    await expectEndsOn(phaseCtx({ log }), { startEntryId: 'e1', endEntryId: 'e3' })
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(log.debug).toHaveBeenCalledWith(
      'memory.close_boundary_picked',
      expect.objectContaining({ endEntryId: 'e3', candidates: 2 }),
    )
    expect(sentUser(model)).not.toContain('The newest reply ends at the toll house.')
  })
})

describe('refineBoundaryReply', () => {
  // AC3: the mock matches a request by its rendered schema block, which refinement must not move.
  it("renders the plain schema's JSON Schema", () => {
    expect(z.toJSONSchema(refineBoundaryReply(new Set(['t1', 't2', 't3'])))).toEqual(
      z.toJSONSchema(chapterBoundarySchema),
    )
  })
})

// Chapter 1 ends on e3 and chapter 2 on e5, each stamped; e6 and e7 are the open region.
const AFTER_TWO_CHAPTERS = [
  row('e1', 1, 'opening', 'chap_1'),
  row('e2', 2, 'user_action', 'chap_1'),
  row('e3', 3, 'ai_reply', 'chap_1'),
  row('e4', 4, 'user_action', 'chap_2'),
  row('e5', 5, 'ai_reply', 'chap_2'),
  row('e6', 6, 'user_action'),
  row('e7', 7, 'ai_reply'),
]

function insertChapterRow(
  branchId: string,
  id: string,
  sequenceNumber: number,
  startEntryId: string,
  endEntryId: string,
): void {
  phaseDb.sqlite
    .prepare(
      `INSERT INTO chapters (id, branch_id, sequence_number, title, summary, theme,
         start_entry_id, end_entry_id, token_count, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'A chapter', 'What happened.', 'a crossing', ?, ?, 10, 1, 1, 1)`,
    )
    .run(id, branchId, sequenceNumber, startEntryId, endEntryId)
}

function logChapterWrite(
  branchId: string,
  logPosition: number,
  chapterId: string,
  source: string,
  op: 'create' | 'update',
): void {
  phaseDb.sqlite
    .prepare(
      `INSERT INTO deltas (id, branch_id, entry_id, action_id, log_position, source,
         target_table, target_id, op, undo_payload, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'chapters', ?, ?, NULL, 1)`,
    )
    .run(
      `delta_${branchId}_${logPosition}`,
      branchId,
      `act_${source}_${chapterId}`,
      logPosition,
      source,
      chapterId,
      op,
    )
}

const chapterRowsOn = (branchId: string): number =>
  (
    phaseDb.sqlite
      .prepare('SELECT COUNT(*) AS n FROM chapters WHERE branch_id = ?')
      .get(branchId) as { n: number }
  ).n

const rerunRefused = (detail: string) => ({
  status: 'failed',
  error: { kind: 'phase-logic', phaseName: CLOSE_PHASE.boundary, detail },
})

describe('closeBoundaryPhase under a re-run', () => {
  beforeEach(() => {
    hydrateEntries(phaseDb, 'b1', AFTER_TWO_CHAPTERS)
    insertChapterRow('b1', 'chap_1', 1, 'e1', 'e3')
    insertChapterRow('b1', 'chap_2', 2, 'e4', 'e5')
    logChapterWrite('b1', 1, 'chap_1', 'chapter_close', 'create')
    logChapterWrite('b1', 2, 'chap_2', 'chapter_close', 'create')
    // Another branch of the one database: a fork's chapter shares chap_2's id and sits past b1's
    // latest number, with a close's write on it; its range (x1–x2) is not b1's.
    insertChapterRow('b2', 'chap_2', 3, 'x1', 'x2')
    insertChapterRow('b2', 'chap_b2_only', 4, 'x3', 'x4')
    logChapterWrite('b2', 1, 'chap_2', 'chapter_close', 'create')
    // The open region's own pick, which a re-run never reads.
    generationStore.setPendingClose('b1', { endEntryId: 'e7' })
  })

  afterEach(() => {
    phaseDb.sqlite.exec('DELETE FROM deltas; DELETE FROM chapters')
  })

  it("parks the latest chapter's own range from its row, with no call and no write", async () => {
    generationStore.setPendingRerun('b1', { chapterId: 'chap_2' })
    const ctx = phaseCtx()

    const { events, result } = await drain(ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    expect(closeRangeOf(ctx.intermediates)).toEqual({
      chapterId: 'chap_2',
      startEntryId: 'e4',
      endEntryId: 'e5',
    })
    expect(getModel).not.toHaveBeenCalled()
    expect(chapterRowsOn('b1')).toBe(2)
    expect(pickOn('b1')).toEqual({ endEntryId: 'e7' })
  })

  it('fails on a chapter no longer the latest, leaving the pick', async () => {
    generationStore.setPendingRerun('b1', { chapterId: 'chap_1' })
    const ctx = phaseCtx()

    const { events, result } = await drain(ctx)

    expect(result).toEqual(rerunRefused('chapter-close: chapter 1 is not the latest; 2 is'))
    expect(events).toEqual([])
    expect(ctx.intermediates).toEqual({})
    expect(pickOn('b1')).toEqual({ endEntryId: 'e7' })
  })

  it('fails on a chapter no close wrote, whatever else wrote its row', async () => {
    phaseDb.sqlite.exec("DELETE FROM deltas WHERE target_id = 'chap_2' AND branch_id = 'b1'")
    logChapterWrite('b1', 3, 'chap_2', 'user_edit', 'update')
    generationStore.setPendingRerun('b1', { chapterId: 'chap_2' })
    const ctx = phaseCtx()

    const { result } = await drain(ctx)

    expect(result).toEqual(rerunRefused('chapter-close: no close wrote chapter chap_2'))
    expect(ctx.intermediates).toEqual({})
  })

  it('fails on a chapter only another branch holds, whatever number it carries there', async () => {
    generationStore.setPendingRerun('b1', { chapterId: 'chap_b2_only' })
    const ctx = phaseCtx()

    const { result } = await drain(ctx)

    expect(result).toEqual(
      rerunRefused('chapter-close: no chapter chap_b2_only to re-run on branch b1'),
    )
    expect(ctx.intermediates).toEqual({})
  })

  it('fails on a chapter the branch no longer holds', async () => {
    generationStore.setPendingRerun('b1', { chapterId: 'chap_gone' })
    const ctx = phaseCtx()

    const { result } = await drain(ctx)

    expect(result).toEqual(
      rerunRefused('chapter-close: no chapter chap_gone to re-run on branch b1'),
    )
    expect(ctx.intermediates).toEqual({})
  })

  it("leaves this branch's close to its pick while another branch's re-run holds", async () => {
    generationStore.setPendingRerun('b2', { chapterId: 'chap_2' })

    await expectEndsOn(phaseCtx(), { startEntryId: 'e6', endEntryId: 'e7' })
  })
})
