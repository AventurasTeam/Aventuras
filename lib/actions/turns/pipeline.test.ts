import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { getPipeline } from '@/lib/pipeline'
import { appSettingsStore, currentStoryStore, resetAllStores } from '@/lib/stores'

import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './pipeline'

const { getModelMock, streamProviderCallMock } = vi.hoisted(() => ({
  getModelMock: vi.fn(),
  streamProviderCallMock: vi.fn(),
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getModel: getModelMock,
    streamProviderCall: streamProviderCallMock,
  }
})

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

function failingStream() {
  return {
    textStream: (async function* () {
      throw new Error('stop after call')
    })(),
  }
}

async function runNarrativePhase() {
  ensurePerTurnPipelineRegistered()
  const phase = getPipeline(PER_TURN_KIND).phases[1]
  if (!phase || !('run' in phase)) throw new Error('expected a single-run narrative phase node')
  return phase
    .run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger('act_1'),
      db: {} as never,
      storyId: 's1',
      branchId: 'b1',
    })
    .next()
}

beforeEach(() => {
  vi.restoreAllMocks()
  getModelMock.mockReset().mockReturnValue({})
  streamProviderCallMock.mockReset().mockReturnValue(failingStream())
  resetAllStores()
})

describe('per-turn pipeline declaration', () => {
  it('registers phase 0 user-action-translation then narrative, aligned to canonical V1', () => {
    ensurePerTurnPipelineRegistered()
    const p = getPipeline(PER_TURN_KIND)
    expect(p.phases.map((n) => n.name)).toEqual(['user-action-translation', 'narrative'])
    expect(p.affordance).toBe('pill-and-banner')
    expect(p.concurrencyPolicy.blockedBy).toEqual(['per-turn', 'chapter-close'])
    // phase 0 declares no resolver: the en short-circuit makes no LLM call
    expect(p.phases[0]).not.toHaveProperty('resolves')
  })

  it('user-action-translation short-circuits: yields no events, completes', async () => {
    ensurePerTurnPipelineRegistered()
    const phase0 = getPipeline(PER_TURN_KIND).phases[0]
    if (!phase0 || !('run' in phase0)) throw new Error('expected a single-run phase node')
    const ctx = {
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger('act_1'),
      db: {} as never,
      storyId: 's1',
      branchId: 'b1',
    }
    const gen = phase0.run(ctx)
    const result = await gen.next()
    // done:true on the FIRST next() proves it yielded no events (no delta / no
    // translation row) and returned completed — the same-language short-circuit.
    expect(result).toEqual({ done: true, value: { status: 'completed' } })
  })

  it('uses the story narrative model override', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: { narrative: 'story-model' } } as never,
    })
    vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
      ...APP_SETTINGS_DEFAULTS,
      providers: [provider],
      profiles: [
        {
          id: 'prof-narrative',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: provider.id, modelId: 'global-model' },
        },
      ],
      defaultProviderId: provider.id,
    })

    await runNarrativePhase()

    expect(getModelMock).toHaveBeenCalledWith(provider.id, 'story-model', 'act_1')
  })

  it('rejects an open story from a different story on the same branch', async () => {
    currentStoryStore.set({
      storyId: 's2',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {} } as never,
    })

    const result = await runNarrativePhase()

    expect(result).toEqual({
      done: true,
      value: {
        status: 'failed',
        error: { kind: 'orchestrator', detail: 'per-turn: no open story for branch' },
      },
    })
    expect(getModelMock).not.toHaveBeenCalled()
  })

  it('maps narrative profile parameters to SDK stream options', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {} } as never,
    })
    vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
      ...APP_SETTINGS_DEFAULTS,
      providers: [provider],
      profiles: [
        {
          id: 'prof-narrative',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: provider.id, modelId: 'global-model' },
          temperature: 0.7,
          maxOutput: 2048,
          thinking: 1024,
          timeout: 45,
        },
      ],
      defaultProviderId: provider.id,
    })

    await runNarrativePhase()

    expect(streamProviderCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
        maxOutputTokens: 2048,
        providerOptions: {
          anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } },
        },
        timeout: { totalMs: 45_000 },
      }),
    )
  })
})
