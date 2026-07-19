import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { appSettingsStore, currentStoryStore, entriesStore, resetAllStores } from '@/lib/stores'

import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './per-turn'
import { getPipeline } from '../authoring/registry'

const { streamTextMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    streamText: streamTextMock,
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

function failingStreamCall() {
  return {
    ok: true,
    modelId: 'model-1',
    stream: {
      fullStream: (async function* () {
        throw new Error('stop after call')
      })(),
    },
  }
}

async function runNarrativePhase(abortSignal = new AbortController().signal) {
  ensurePerTurnPipelineRegistered()
  const phase = getPipeline(PER_TURN_KIND).phases[1]
  if (!phase || !('run' in phase)) throw new Error('expected a single-run narrative phase node')
  return phase
    .run({
      actionId: 'act_1',
      abortSignal,
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
  streamTextMock.mockReset().mockReturnValue(failingStreamCall())
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
    entriesStore.hydrate('b1', [])
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

    expect(streamTextMock).toHaveBeenCalledWith(
      'narrative',
      expect.objectContaining({
        actionId: 'act_1',
        config: expect.objectContaining({ storyModels: { narrative: 'story-model' } }),
      }),
    )
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
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('fails when the entries store is loaded for another branch', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {} } as never,
    })
    entriesStore.hydrate('b-other', [])

    const result = await runNarrativePhase()

    expect(result).toEqual({
      done: true,
      value: {
        status: 'failed',
        error: {
          kind: 'orchestrator',
          detail: 'per-turn: entries store loaded for another branch',
        },
      },
    })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('returns aborted, committing nothing, when a cancel ends the stream gracefully', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {} } as never,
    })
    entriesStore.hydrate('b1', [])
    const controller = new AbortController()
    // ai@6 fullStream ends without throwing on abort (an 'abort' part, no
    // onError) — the phase must classify via the signal, not a stream error.
    streamTextMock.mockReturnValue({
      ok: true,
      modelId: 'model-1',
      stream: {
        fullStream: (async function* () {
          controller.abort()
        })(),
      },
    })

    const result = await runNarrativePhase(controller.signal)

    // done:true on the FIRST next() proves no delta_emitted was yielded — the
    // partial entry is discarded, not committed.
    expect(result).toEqual({ done: true, value: { status: 'aborted' } })
  })

  it('surfaces a resolve failure as a config-resolver phase error', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {} } as never,
    })
    entriesStore.hydrate('b1', [])
    streamTextMock.mockReturnValue({
      ok: false,
      kind: 'no-profile-assigned',
      target: 'narrative',
    })

    const result = await runNarrativePhase()

    expect(result).toEqual({
      done: true,
      value: {
        status: 'failed',
        error: {
          kind: 'config-resolver',
          failure: 'no-profile-assigned',
          target: 'narrative',
          phaseName: 'narrative',
        },
      },
    })
  })
})
