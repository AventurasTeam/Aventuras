import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CallRetryError, generateStructured } from '@/lib/ai'
import { STORY_SETTINGS_DEFAULTS, type StoryEntry, type Thread, type ThreadStatus } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import {
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  hydrateAppSettings,
  resetAllStores,
  threadsStore,
  type StoreChapter,
} from '@/lib/stores'

import { createPhaseDb, hydrateEntries, resetPhaseDb, type PhaseDb } from './__tests__/phase-db'
import { readCloseRangeEntries, requestChapterMetadata } from './chapter-close-metadata-call'
import { chapterMetadataSchema, type ChapterMetadata } from './chapter-metadata-schema'
import type { CloseRange } from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PipelineError } from '../types'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, generateStructured: generateStructuredMock }
})

const DEFINITION = {
  mode: 'adventure' as const,
  leadEntityId: null,
  narration: 'second' as const,
  genre: { label: 'Fantasy', promptBody: '' },
  tone: { label: 'Wry', promptBody: '' },
  setting: 'A drowned coast of salt marsh and broken keeps.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

function row(
  id: string,
  position: number,
  kind: StoryEntry['kind'],
  content: string,
  over: Partial<StoryEntry> = {},
): StoryEntry {
  return {
    id,
    branchId: 'b1',
    position,
    kind,
    content,
    contentTokens: null,
    chapterId: null,
    metadata: null,
    createdAt: position,
    ...over,
  }
}

// Prose, as a real close reads it (lessons-learned → token fixtures need real prose).
const ENTRIES: StoryEntry[] = [
  row(
    'e1',
    1,
    'opening',
    'The marsh road ended at a wall of black water, and the drowned keep leaned out of the fog beyond it.',
  ),
  row('e2', 2, 'user_action', 'I wade in, holding the sigil above my head.'),
  row(
    'e3',
    3,
    'ai_reply',
    'The cold takes your breath at once. Halfway across, the current tugs the sigil from your fingers, and it is gone.\n<state><summary>The sigil is lost</summary></state>',
  ),
  row('s4', 4, 'system', 'The classifier could not read this turn.'),
  row('e5', 5, 'user_action', 'I climb out on the far bank and look for Mora.'),
  row(
    'e6',
    6,
    'ai_reply',
    'Mora is waiting by the ford with a shuttered lantern. She asks where the sigil is, and you have no answer for her.',
  ),
  row('e7', 7, 'user_action', 'I tell her the truth.'),
  row('e8', 8, 'ai_reply', 'She laughs, not kindly, and turns toward the keep.'),
]

const OTHER_BRANCH = row(
  'x2',
  2,
  'ai_reply',
  'On another branch entirely, nobody crossed the marsh at all.',
  { branchId: 'b2' },
)

const RANGE: CloseRange = {
  chapterId: 'chap_11111111-1111-4111-8111-111111111111',
  startEntryId: 'e1',
  endEntryId: 'e6',
}

const REPLY: ChapterMetadata = {
  title: 'The Ford at Dusk',
  summary:
    'You waded the marsh and lost the sigil to the current. Mora met you at the ford, and you had no answer for her.',
  theme: 'loss',
  keywords: ['Mora', 'the ford', 'the sigil'],
}

function thread(id: string, title: string, status: ThreadStatus): Thread {
  return {
    id,
    branchId: 'b1',
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

function chapter(sequenceNumber: number, summary: string): StoreChapter {
  return {
    id: `chap_${sequenceNumber}`,
    branchId: 'b1',
    sequenceNumber,
    title: `Chapter ${sequenceNumber}`,
    summary,
    theme: 'loss',
    keywords: [],
    startEntryId: 'e_start',
    endEntryId: 'e_end',
    tokenCount: 1200,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: false,
  }
}

const PROVIDER = {
  id: 'prov-1',
  type: 'openai-compatible' as const,
  displayName: 'Local',
  apiKey: 'k',
  endpoint: 'http://x/v1',
  favoriteModelIds: [] as string[],
}

function agentProfile(id: string, timeout: number | undefined) {
  return {
    id,
    kind: 'agent' as const,
    name: id,
    modelRef: { providerId: PROVIDER.id, modelId: 'm' },
    ...(timeout !== undefined ? { timeout } : {}),
  }
}

// Profile timeouts are seconds, as the call settings read them.
async function wireModels(timeouts: { lore?: number; classifier?: number } = {}): Promise<void> {
  const result = await hydrateAppSettings(async () => ({
    providers: [PROVIDER],
    profiles: [
      agentProfile('prof-lore', timeouts.lore),
      agentProfile('prof-classifier', timeouts.classifier),
    ],
    assignments: { 'lore-mgmt': 'prof-lore', classifier: 'prof-classifier' },
    defaultProviderId: PROVIDER.id,
    diagnostics: { enabled: false, debug_level_enabled: false },
  }))
  expect(result).toEqual({ status: 'ok' })
}

function openBranch(): void {
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
  })
  entitiesStore.hydrate('b1', [])
  chaptersStore.hydrate('b1', [])
  threadsStore.hydrate('b1', [])
  hydrateEntries(phaseDb, 'b2', [OTHER_BRANCH])
  hydrateEntries(phaseDb, 'b1', ENTRIES)
}

function phaseCtx(abortSignal: AbortSignal = new AbortController().signal): PhaseContext {
  return {
    actionId: 'act_close',
    abortSignal,
    intermediates: {},
    log: makeLogger('act_close'),
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
  }
}

async function drain(ctx: PhaseContext, range: CloseRange = RANGE) {
  const gen = requestChapterMetadata(ctx, range)
  const events: PhaseEmittedEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, outcome: next.value }
    events.push(next.value)
  }
}

let phaseDb: PhaseDb

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

beforeEach(async () => {
  generateStructuredMock.mockReset()
  resetPhaseDb(phaseDb)
  resetAllStores()
  await wireModels()
  openBranch()
})

describe('readCloseRangeEntries', () => {
  it("reads the range's whole non-system rows, oldest first", async () => {
    const rows = await readCloseRangeEntries(phaseDb.db, 'b1', RANGE)
    expect(rows.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e5', 'e6'])
    // Whole rows: the trailing block is the builder's to strip.
    expect(rows[2]).toMatchObject({ id: 'e3', kind: 'ai_reply', content: ENTRIES[2]!.content })
  })

  it("starts at the range's start, past a closed chapter's rows", async () => {
    hydrateEntries(
      phaseDb,
      'b1',
      ENTRIES.map((e) => (e.position <= 3 ? { ...e, chapterId: 'chap_first' } : e)),
    )
    const rows = await readCloseRangeEntries(phaseDb.db, 'b1', { ...RANGE, startEntryId: 'e5' })
    expect(rows.map((e) => e.id)).toEqual(['e5', 'e6'])
  })

  // x2 is another branch's row: a fork copies rows with their ids, so an id alone is ambiguous.
  it('reads nothing for an end entry the branch does not have', async () => {
    expect(await readCloseRangeEntries(phaseDb.db, 'b1', { ...RANGE, endEntryId: 'x2' })).toEqual(
      [],
    )
  })

  it('reads nothing for a start entry the branch does not have', async () => {
    expect(await readCloseRangeEntries(phaseDb.db, 'b1', { ...RANGE, startEntryId: 'x2' })).toEqual(
      [],
    )
  })
})

describe('requestChapterMetadata', () => {
  it('asks the lore-mgmt agent once, with no output bound of its own, and normalizes the reply', async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: {
        title: '  The Ford at Dusk ',
        summary: ` ${REPLY.summary}\n`,
        theme: ' loss ',
        keywords: ['Mora', 'mora', ' the ford ', '', 'the sigil'],
      },
      recoverable: [],
    })

    const { events, outcome } = await drain(phaseCtx())

    expect(outcome).toEqual({ status: 'ok', metadata: REPLY })
    expect(events).toEqual([])
    expect(generateStructuredMock).toHaveBeenCalledOnce()
    const [target, , schema, config, , options] = generateStructuredMock.mock.calls[0]!
    expect(target).toBe('lore-mgmt')
    expect(schema).toBe(chapterMetadataSchema)
    expect(config).toMatchObject({ assignments: { 'lore-mgmt': 'prof-lore' }, storyModels: {} })
    expect(options).toEqual({ actionId: 'act_close' })
  })

  it('prompts with the range, the latest chapter before it and the open threads', async () => {
    chaptersStore.hydrate('b1', [
      chapter(1, 'Kael left the keep at dawn with the stolen sigil.'),
      chapter(2, 'Kael reached the marsh as the bells began to ring.'),
    ])
    threadsStore.hydrate('b1', [
      thread('thr_1', 'Find the heir', 'active'),
      thread('thr_2', 'The ford crossing', 'pending'),
      thread('thr_3', 'The lost map', 'resolved'),
      thread('thr_4', 'Warn the abbey', 'failed'),
    ])
    generateStructuredMock.mockResolvedValue({ status: 'ok', value: REPLY, recoverable: [] })

    await drain(phaseCtx())

    const { system, user } = generateStructuredMock.mock.calls[0]![1]
    expect(user).toContain('The marsh road ended at a wall of black water')
    expect(user).toContain('<user_turn>\nI wade in, holding the sigil above my head.\n</user_turn>')
    expect(user).toContain('Mora is waiting by the ford with a shuttered lantern.')
    expect(user).not.toContain('She laughs, not kindly')
    expect(user).not.toContain('The classifier could not read this turn.')
    expect(user).not.toContain('<state>')
    expect(user).not.toContain('nobody crossed the marsh')
    expect(user).toContain(
      '# The previous chapter\nKael reached the marsh as the bells began to ring.',
    )
    expect(user).not.toContain('Kael left the keep at dawn')
    expect(user).toContain('- Find the heir (active)\n- The ford crossing (pending)')
    expect(user).not.toContain('The lost map')
    expect(user).not.toContain('Warn the abbey')
    expect(system).not.toContain('Mora')
    expect(system).not.toContain('Find the heir')
    // The open story's mode reaches the prompt: DEFINITION is an adventure.
    expect(system).toContain('Each is what the lead does, says or attempts')
  })

  it('yields a recoverable_error per retried attempt before its outcome', async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: REPLY,
      recoverable: [
        { tier: 'provider', reason: 'timeout' },
        { tier: 'parse', detail: 'reply was not JSON', attempt: 1 },
      ],
    })

    const { events, outcome } = await drain(phaseCtx())

    expect(events).toEqual([
      { type: 'recoverable_error', error: { kind: 'provider', reason: 'timeout' } },
      { type: 'recoverable_error', error: { kind: 'phase-logic', detail: 'reply was not JSON' } },
    ])
    expect(outcome).toMatchObject({ status: 'ok' })
  })

  it.each([
    {
      name: 'a provider failure',
      error: { tier: 'provider', reason: 'network', detail: 'ECONNREFUSED' },
      expected: { kind: 'provider', reason: 'network', detail: 'ECONNREFUSED' },
    },
    {
      name: 'a parse failure after its retries',
      error: { tier: 'parse', detail: 'title: Invalid string', attempt: 3 },
      expected: { kind: 'phase-logic', detail: 'title: Invalid string' },
    },
    {
      name: 'a window refusal',
      error: {
        tier: 'context-window',
        detectedBy: 'check',
        estimate: 41_000,
        providerId: 'prov-1',
        modelId: 'm',
        window: 32_768,
        windowSource: 'configured',
      },
      expected: {
        kind: 'context-window',
        target: 'lore-mgmt',
        detectedBy: 'check',
        estimate: 41_000,
        providerId: 'prov-1',
        modelId: 'm',
        window: 32_768,
        windowSource: 'configured',
      },
    },
    {
      name: 'a reply cut off short of a whole document',
      error: {
        tier: 'reply-cut-off',
        cause: 'max-output',
        outputTokens: 512,
        reasoningTokens: null,
        maxOutput: 512,
        window: null,
        providerId: 'prov-1',
        modelId: 'm',
      },
      expected: {
        kind: 'reply-cut-off',
        target: 'lore-mgmt',
        cause: 'max-output',
        outputTokens: 512,
        reasoningTokens: null,
        maxOutput: 512,
        window: null,
        providerId: 'prov-1',
        modelId: 'm',
      },
    },
  ] satisfies { name: string; error: CallRetryError; expected: PipelineError }[])(
    'fails on $name',
    async ({ error, expected }) => {
      generateStructuredMock.mockResolvedValue({ status: 'failed', error, recoverable: [] })
      const { outcome } = await drain(phaseCtx())
      expect(outcome).toEqual({ status: 'failed', error: expected })
    },
  )

  it("fails as a config fault when the lore-mgmt model doesn't resolve", async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'not-configured',
      kind: 'no-profile-assigned',
    })
    const { outcome } = await drain(phaseCtx())
    expect(outcome).toEqual({
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: 'no-profile-assigned',
        target: 'lore-mgmt',
        phaseName: 'metadata',
      },
    })
  })

  it('returns aborted on a cancel, after the events of the attempts it retried', async () => {
    const controller = new AbortController()
    generateStructuredMock.mockImplementation(
      (...args: unknown[]) =>
        new Promise((resolve) => {
          const signal = args[4] as AbortSignal
          const settle = () =>
            resolve({ status: 'aborted', recoverable: [{ tier: 'provider', reason: 'network' }] })
          if (signal.aborted) settle()
          else signal.addEventListener('abort', settle)
        }) as never,
    )

    const call = drain(phaseCtx(controller.signal))
    controller.abort()
    const { events, outcome } = await call

    expect(outcome).toEqual({ status: 'aborted' })
    expect(events).toEqual([
      { type: 'recoverable_error', error: { kind: 'provider', reason: 'network' } },
    ])
  })

  it.each([
    { name: 'no story is open', unload: () => currentStoryStore.clear() },
    { name: 'the stores hold another branch', unload: () => entitiesStore.hydrate('b2', []) },
  ])('fails before any call when $name', async ({ unload }) => {
    unload()
    const { events, outcome } = await drain(phaseCtx())
    expect(outcome).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    })
    expect(events).toEqual([])
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  // classifier.md → Failure policy: a never-answering provider expires as a failure, not an abort.
  describe('the bound on the call', () => {
    // Resolves with the fake-clock ms in flight when the call's signal aborts: the bound it armed.
    function callAbortedAfter(): Promise<number> {
      return new Promise((reportElapsed) => {
        generateStructuredMock.mockImplementation(
          (...args: unknown[]) =>
            new Promise((resolve) => {
              const signal = args[4] as AbortSignal
              const startedAt = Date.now()
              signal.addEventListener('abort', () => {
                reportElapsed(Date.now() - startedAt)
                resolve({ status: 'aborted', recoverable: [] })
              })
            }) as never,
        )
      })
    }

    async function runToExpiry() {
      vi.useFakeTimers()
      try {
        const elapsed = callAbortedAfter()
        const call = drain(phaseCtx())
        // Past every bound under test, so a wrong one still expires and the assertion names it.
        await vi.advanceTimersByTimeAsync(1_000_000)
        return { elapsedMs: await elapsed, ...(await call) }
      } finally {
        vi.useRealTimers()
      }
    }

    it("fails at the lore-mgmt profile's timeout, not the classifier's", async () => {
      await wireModels({ lore: 45, classifier: 30 })

      const { elapsedMs, events, outcome } = await runToExpiry()

      expect(elapsedMs).toBe(45_000)
      expect(events).toEqual([])
      expect(outcome).toEqual({
        status: 'failed',
        error: { kind: 'provider', reason: 'timeout', detail: 'lore-mgmt: timeout after 45000ms' },
      })
    })

    it('disarms the bound once the call settles', async () => {
      generateStructuredMock.mockResolvedValue({ status: 'ok', value: REPLY, recoverable: [] })
      vi.useFakeTimers()
      try {
        const { outcome } = await drain(phaseCtx())
        expect(outcome).toMatchObject({ status: 'ok' })
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('bounds the call at ten minutes when the lore-mgmt profile sets no timeout', async () => {
      await wireModels({ classifier: 30 })

      const { elapsedMs, outcome } = await runToExpiry()

      expect(elapsedMs).toBe(600_000)
      expect(outcome).toMatchObject({
        status: 'failed',
        error: { detail: 'lore-mgmt: timeout after 600000ms' },
      })
    })
  })
})
