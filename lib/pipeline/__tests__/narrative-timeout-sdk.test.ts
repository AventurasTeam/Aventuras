import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getModel } from '@/lib/ai/model'
import { APP_SETTINGS_DEFAULTS, STORY_SETTINGS_DEFAULTS } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { appSettingsStore, currentStoryStore, entitiesStore, resetAllStores } from '@/lib/stores'

import { getPipeline } from '../authoring/registry'
import {
  createPhaseDb,
  hydrateEntries,
  resetPhaseDb,
  type PhaseDb,
} from '../definitions/__tests__/phase-db'
import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from '../definitions/per-turn'
import type { PhaseEmittedEvent, PhaseResult } from '../types'

// The provider is the only fake: the real facade, bound and SDK stream run between it and the phase.
vi.mock('@/lib/ai/model', () => ({ getModel: vi.fn() }))

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV3['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never

const TIMEOUT_SECONDS = 0.05

const provider = {
  id: 'prov-1',
  type: 'anthropic' as const,
  displayName: 'Anthropic',
  apiKey: 'key',
  favoriteModelIds: [],
}

const definition = {
  mode: 'adventure' as const,
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first' as const,
  genre: { label: 'Fantasy', promptBody: 'High fantasy.' },
  tone: { label: 'Wry', promptBody: 'Dry humor.' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

// Emits `parts`, then holds the stream open until the call's signal aborts, as a stalled fetch does.
function stallingModel(parts: StreamPart[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => ({
      stream: simulateReadableStream({
        chunks: parts,
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }).pipeThrough(
        new TransformStream<StreamPart, StreamPart>({
          flush: () =>
            new Promise<void>((_, reject) => {
              abortSignal?.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')),
              )
            }),
        }),
      ),
    }),
  })
}

const opening: StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'The lantern gutt' },
]

async function runNarrativePhase(): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  ensurePerTurnPipelineRegistered()
  const phase = getPipeline(PER_TURN_KIND).phases[2]
  if (!phase || !('run' in phase)) throw new Error('expected a single-run narrative phase node')
  const gen = phase.run({
    actionId: 'act_1',
    abortSignal: new AbortController().signal,
    intermediates: {},
    log: makeLogger('act_1'),
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
  })
  const events: PhaseEmittedEvent[] = []
  let next = await gen.next()
  while (!next.done) {
    events.push(next.value)
    next = await gen.next()
  }
  return { events, result: next.value }
}

let phaseDb: PhaseDb

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

beforeEach(() => {
  resetAllStores()
  resetPhaseDb(phaseDb)
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition,
    settings: { ...STORY_SETTINGS_DEFAULTS, partialChapterBuffer: 3 },
  })
  hydrateEntries(phaseDb, 'b1', [])
  entitiesStore.hydrate('b1', [])
  vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
    ...APP_SETTINGS_DEFAULTS,
    providers: [provider],
    profiles: [
      {
        id: 'prof-narrative',
        kind: 'narrative',
        name: 'Narrative',
        modelRef: { providerId: provider.id, modelId: 'model-1' },
        timeout: TIMEOUT_SECONDS,
      },
    ],
    defaultProviderId: provider.id,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// generation-pipeline.md → Two retry tiers: an expired stream closes the way a cancel does.
describe('narrative timeout through the real SDK stream', () => {
  it('fails a stalled stream as a provider timeout, committing nothing', async () => {
    vi.mocked(getModel).mockReturnValue(stallingModel(opening))

    const { events, result } = await runNarrativePhase()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'provider', reason: 'timeout', detail: 'narrative: timeout after 50ms' },
    })
    expect(events.map((e) => e.type)).toEqual(['stream_chunk'])
  })

  it('names the error part a stall followed', async () => {
    vi.mocked(getModel).mockReturnValue(
      stallingModel([...opening, { type: 'error', error: new Error('upstream overloaded') }]),
    )

    const { events, result } = await runNarrativePhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'provider',
        reason: 'timeout',
        detail: 'narrative: timeout after 50ms; earlier stream error: upstream overloaded',
      },
    })
    expect(events.map((e) => e.type)).toEqual(['stream_chunk'])
  })
})
