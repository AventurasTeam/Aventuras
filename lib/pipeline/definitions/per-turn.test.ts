import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS } from '@/lib/db'
import { logger, makeLogger } from '@/lib/diagnostics'
import {
  appSettingsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  resetAllStores,
} from '@/lib/stores'

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
    providerId: 'prov-1',
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
  const gen = phase.run({
    actionId: 'act_1',
    abortSignal,
    intermediates: {},
    log: makeLogger('act_1'),
    db: {} as never,
    storyId: 's1',
    branchId: 'b1',
  })
  let next = await gen.next()
  while (!next.done) next = await gen.next()
  return next.value
}

beforeEach(() => {
  vi.restoreAllMocks()
  streamTextMock.mockReset().mockReturnValue(failingStreamCall())
  resetAllStores()
})

describe('per-turn pipeline declaration', () => {
  it('registers phase 0 user-action-translation then narrative then piggyback-fallback-classifier, aligned to canonical V1', () => {
    ensurePerTurnPipelineRegistered()
    const p = getPipeline(PER_TURN_KIND)
    expect(p.phases.map((n) => n.name)).toEqual([
      'user-action-translation',
      'narrative',
      'piggyback-fallback-classifier',
    ])
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
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'per-turn: no open story for branch' },
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
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: 'per-turn: entries store loaded for another branch',
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
      providerId: 'prov-1',
      stream: {
        fullStream: (async function* () {
          controller.abort()
        })(),
      },
    })

    const result = await runNarrativePhase(controller.signal)

    expect(result).toEqual({ status: 'aborted' })
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
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: 'no-profile-assigned',
        target: 'narrative',
        phaseName: 'narrative',
      },
    })
  })

  it('applies piggyback actions and sets piggybackOutcome in intermediates when piggyback fires, resolving the model-emitted placeholder back to the real entity id', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {}, piggybackMode: 'on' } as never,
    })
    const heroId = 'char_00000000-0000-4000-8000-000000000001'
    entriesStore.hydrate('b1', [])
    entitiesStore.hydrate('b1', [
      {
        id: heroId,
        branchId: 'b1',
        kind: 'character',
        status: 'staged',
        name: 'Hero',
      } as never,
    ])
    vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
      ...APP_SETTINGS_DEFAULTS,
      providers: [
        {
          ...provider,
          cachedModels: [
            {
              id: 'model-1',
              capabilities: { taggedBlockReliable: true },
            },
          ],
        },
      ],
      profiles: [
        {
          id: 'prof-narrative',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: provider.id, modelId: 'model-1' },
        },
      ],
      defaultProviderId: provider.id,
    })

    // The model sees `heroId` only as the bracketed placeholder 'c1' (the
    // narrative prompt substitutes real ids), and it emits that placeholder
    // back verbatim — never the real id.
    streamTextMock.mockReturnValue({
      ok: true,
      modelId: 'model-1',
      providerId: 'prov-1',
      stream: {
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            text: 'The story begins.\n<state><scene_entities>c1</scene_entities><world_time_delta>15</world_time_delta></state>',
          }
        })(),
      },
    })

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[1]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ next: 1 }]),
          }),
        }),
      } as never,
      storyId: 's1',
      branchId: 'b1',
    })

    const events = []
    let next = await gen.next()
    while (!next.done) {
      events.push(next.value)
      next = await gen.next()
    }

    expect(next.value).toEqual({ status: 'completed' })
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: true })

    // First stream_chunk event
    expect(events[0]).toEqual({
      type: 'stream_chunk',
      targetEntryId: expect.any(String),
      text: 'The story begins.\n<state><scene_entities>c1</scene_entities><world_time_delta>15</world_time_delta></state>',
      channel: 'text',
    })

    // Second event: createStoryEntry delta with piggyback metadata — the
    // placeholder 'c1' resolved back to heroId's real UUID.
    expect(events[1]).toEqual({
      type: 'delta_emitted',
      entryId: expect.any(String),
      action: expect.objectContaining({
        kind: 'createStoryEntry',
        payload: expect.objectContaining({
          entry: expect.objectContaining({
            content: expect.stringContaining('<state>'),
            metadata: expect.objectContaining({
              sceneEntities: [heroId],
              worldTime: 15,
            }),
          }),
        }),
      }),
    })

    // Third event: piggyback action promoteStagedEntity, targeting the real id
    expect(events[2]).toEqual({
      type: 'delta_emitted',
      action: {
        kind: 'promoteStagedEntity',
        source: 'piggyback_tagged_block',
        payload: { branchId: 'b1', id: heroId },
      },
    })
  })

  it('drops sceneEntities and falls back to the classifier when the model emits an unresolvable placeholder', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {}, piggybackMode: 'on' } as never,
    })
    entriesStore.hydrate('b1', [])
    // 'c99' is never allocated (definition.leadEntityId claims 'c1', nothing
    // else is character-shaped here), so it's placeholder-shaped but
    // unresolvable — MalformedPlaceholderError.
    entitiesStore.hydrate('b1', [])
    vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
      ...APP_SETTINGS_DEFAULTS,
      providers: [
        {
          ...provider,
          cachedModels: [{ id: 'model-1', capabilities: { taggedBlockReliable: true } }],
        },
      ],
      profiles: [
        {
          id: 'prof-narrative',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: provider.id, modelId: 'model-1' },
        },
      ],
      defaultProviderId: provider.id,
    })

    streamTextMock.mockReturnValue({
      ok: true,
      modelId: 'model-1',
      providerId: 'prov-1',
      stream: {
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            text: 'The story begins.\n<state><scene_entities>c99</scene_entities><world_time_delta>15</world_time_delta></state>',
          }
        })(),
      },
    })

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[1]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ next: 1 }]) }) }),
      } as never,
      storyId: 's1',
      branchId: 'b1',
    })

    const events = []
    let next = await gen.next()
    while (!next.done) {
      events.push(next.value)
      next = await gen.next()
    }

    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    // Second event: createStoryEntry — sceneEntities falls back to the
    // (empty) inherited value since the unresolvable placeholder dropped the field.
    expect(events[1]).toEqual({
      type: 'delta_emitted',
      entryId: expect.any(String),
      action: expect.objectContaining({
        kind: 'createStoryEntry',
        payload: expect.objectContaining({
          entry: expect.objectContaining({
            metadata: expect.objectContaining({ sceneEntities: [] }),
          }),
        }),
      }),
    })
  })

  it('logs classifier.piggyback_parse_failed when a location placeholder fails substitution', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')

    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {}, piggybackMode: 'on' } as never,
    })
    entriesStore.hydrate('b1', [])
    entitiesStore.hydrate('b1', [])
    vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
      ...APP_SETTINGS_DEFAULTS,
      providers: [
        {
          ...provider,
          cachedModels: [{ id: 'model-1', capabilities: { taggedBlockReliable: true } }],
        },
      ],
      profiles: [
        {
          id: 'prof-narrative',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: provider.id, modelId: 'model-1' },
        },
      ],
      defaultProviderId: provider.id,
    })

    streamTextMock.mockReturnValue({
      ok: true,
      modelId: 'model-1',
      providerId: 'prov-1',
      stream: {
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            text: 'The story begins.\n<state><current_location>l999</current_location></state>',
          }
        })(),
      },
    })

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[1]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: logger,
      db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ next: 1 }]) }) }),
      } as never,
      storyId: 's1',
      branchId: 'b1',
    })

    let result = await gen.next()
    while (!result.done) {
      result = await gen.next()
    }

    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(warnSpy).toHaveBeenCalledWith(
      'classifier.piggyback_parse_failed',
      expect.objectContaining({ fields: ['currentLocation'] }),
    )
  })

  it('clamps negative worldTimeDelta to 0 and logs classifier.delta_clamped warning', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')

    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {}, piggybackMode: 'on' } as never,
    })
    entriesStore.hydrate('b1', [])
    entitiesStore.hydrate('b1', [])
    vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
      ...APP_SETTINGS_DEFAULTS,
      providers: [
        {
          ...provider,
          cachedModels: [
            {
              id: 'model-1',
              capabilities: { taggedBlockReliable: true },
            },
          ],
        },
      ],
      profiles: [
        {
          id: 'prof-narrative',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: provider.id, modelId: 'model-1' },
        },
      ],
      defaultProviderId: provider.id,
    })

    streamTextMock.mockReturnValue({
      ok: true,
      modelId: 'model-1',
      providerId: 'prov-1',
      stream: {
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            text: 'Going back in time?\n<state><world_time_delta>-30</world_time_delta></state>',
          }
        })(),
      },
    })

    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[1]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const intermediates: Record<string, unknown> = {}
    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ next: 1 }]),
          }),
        }),
      } as never,
      storyId: 's1',
      branchId: 'b1',
    })

    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }

    expect(warnSpy).toHaveBeenCalledWith(
      'classifier.delta_clamped',
      expect.objectContaining({
        originalDelta: -30,
        finalDelta: 0,
      }),
    )
  })

  it('sets piggybackOutcome = { attempted: true, succeeded: false } on a malformed block with a capability-flagged model and triggers fallback classifier phase', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: { partialChapterBuffer: 3, models: {}, piggybackMode: 'on' } as never,
    })
    entriesStore.hydrate('b1', [])
    entitiesStore.hydrate('b1', [])
    vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
      ...APP_SETTINGS_DEFAULTS,
      providers: [
        {
          ...provider,
          cachedModels: [
            {
              id: 'model-1',
              capabilities: { taggedBlockReliable: true },
            },
          ],
        },
      ],
      profiles: [
        {
          id: 'prof-narrative',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: provider.id, modelId: 'model-1' },
        },
      ],
      defaultProviderId: provider.id,
    })

    // Emits a malformed block where visual_changes is truncated
    streamTextMock.mockReturnValue({
      ok: true,
      modelId: 'model-1',
      providerId: 'prov-1',
      stream: {
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            text: 'Narrative text\n<state><scene_entities>char_1</scene_entities><visual_changes><entity id="char_1" type="attire">torn cloak</state>',
          }
        })(),
      },
    })

    ensurePerTurnPipelineRegistered()
    const narrativeNode = getPipeline(PER_TURN_KIND).phases[1]
    if (!narrativeNode || !('run' in narrativeNode)) throw new Error('expected narrative phase')

    const intermediates: Record<string, unknown> = {}
    const gen = narrativeNode.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ next: 1 }]),
          }),
        }),
      } as never,
      storyId: 's1',
      branchId: 'b1',
    })

    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }

    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })

    // Verify fallback classifier phase fires when outcome is { attempted: true, succeeded: false }
    const fallbackNode = getPipeline(PER_TURN_KIND).phases[2]
    if (!fallbackNode || !('run' in fallbackNode)) throw new Error('expected fallback phase')

    // Branch has no entries so fallback phase returns completed cleanly without throws
    const fallbackGen = fallbackNode.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      db: {} as never,
      storyId: 's1',
      branchId: 'b1',
    })

    const fallbackResult = await fallbackGen.next()
    expect(fallbackResult).toEqual({ done: true, value: { status: 'completed' } })
  })
})
