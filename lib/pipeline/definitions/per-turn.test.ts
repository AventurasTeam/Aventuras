import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS, STORY_SETTINGS_DEFAULTS, type StorySettings } from '@/lib/db'
import { logger, makeLogger, type Logger } from '@/lib/diagnostics'
import type { TemplateId } from '@/lib/prompts'
import type { Candidate, RetrievalSuccess } from '@/lib/retrieval'
import {
  appSettingsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  resetAllStores,
} from '@/lib/stores'

import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './per-turn'
import { RETRIEVAL_INTERMEDIATE_KEY } from './per-turn-retrieval'
import { getPipeline } from '../authoring/registry'

const { streamTextMock, renderTemplateMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  renderTemplateMock: vi.fn(),
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    streamText: streamTextMock,
  }
})

// Records the context each phase hands over, then renders for real — the
// generation context is the only place a retrieval bundle is observable until
// the bundled pack renders one.
vi.mock('@/lib/prompts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const render = actual.renderTemplate as (id: TemplateId, ctx: Record<string, unknown>) => string
  return {
    ...actual,
    renderTemplate: (templateId: TemplateId, context: Record<string, unknown>) => {
      renderTemplateMock(templateId, context)
      return render(templateId, context)
    },
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

// Both settings writers gate on storySettingsSchema.parse before
// currentStoryStore.set, so a partial settings object never reaches
// production — fixtures use a full default instead of `as never`.
function baseSettings(overrides: Partial<StorySettings> = {}): StorySettings {
  return { ...STORY_SETTINGS_DEFAULTS, ...overrides }
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
  const phase = getPipeline(PER_TURN_KIND).phases[2]
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
  renderTemplateMock.mockReset()
  resetAllStores()
})

describe('per-turn pipeline declaration', () => {
  it('registers phase 0 user-action-translation then retrieval then narrative then piggyback-fallback-classifier, aligned to canonical V1', () => {
    ensurePerTurnPipelineRegistered()
    const p = getPipeline(PER_TURN_KIND)
    expect(p.phases.map((n) => n.name)).toEqual([
      'user-action-translation',
      'retrieval',
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
      settings: baseSettings({ partialChapterBuffer: 3, models: { narrative: 'story-model' } }),
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
      settings: baseSettings({ partialChapterBuffer: 3 }),
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
      settings: baseSettings({ partialChapterBuffer: 3 }),
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
      settings: baseSettings({ partialChapterBuffer: 3 }),
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
      settings: baseSettings({ partialChapterBuffer: 3 }),
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
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
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
    const phase = getPipeline(PER_TURN_KIND).phases[2]
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
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
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
    const phase = getPipeline(PER_TURN_KIND).phases[2]
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
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
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
    const phase = getPipeline(PER_TURN_KIND).phases[2]
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
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
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
    const phase = getPipeline(PER_TURN_KIND).phases[2]
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
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
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
    const narrativeNode = getPipeline(PER_TURN_KIND).phases[2]
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
    const fallbackNode = getPipeline(PER_TURN_KIND).phases[3]
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

const SUGGESTION_CATEGORIES = [
  { id: 'cat_action', label: 'Action', promptHint: 'act', color: 'red', enabled: true, order: 0 },
  {
    id: 'cat_dialogue',
    label: 'Dialogue',
    promptHint: 'say',
    color: 'blue',
    enabled: true,
    order: 1,
  },
]

const RETRIEVED_ENTITY_ID = 'char_00000000-0000-4000-8000-0000000000e9'
const RETRIEVED_LOCATION_ID = 'loc_00000000-0000-4000-8000-0000000000ea'

function entityCandidate(id: string, displayName: string, renderedText: string): Candidate {
  return {
    kind: 'entity',
    id,
    displayName,
    renderedText,
    sims: [0, 0, 0],
    vector: new Float32Array([1, 0, 0]),
    chaptersOld: 0,
    pinSignal: 0,
    keywordHits: [],
    embeddingStale: false,
  }
}

function retrievalIntermediate(
  over: { entities?: Candidate[]; selectedLocationIds?: string[] } = {},
): RetrievalSuccess {
  const selected: Candidate[] = over.entities ?? [
    entityCandidate(RETRIEVED_ENTITY_ID, 'Corvin', 'Corvin (currently elsewhere): a smuggler.'),
  ]
  const emptyBundle = {
    selected: [],
    traces: [],
    funnel: {
      poolSize: 0,
      preFilteredSize: 0,
      selectedCount: 0,
      tokensUsed: 0,
      typeBudget: 0,
    },
  }
  const spec = { text: '', source: 'user_action' as const }
  return {
    ok: true,
    floor: {
      sceneEntities: [],
      currentLocation: null,
      activeThreads: [
        {
          id: 'thr_00000000-0000-4000-8000-0000000000f9',
          status: 'active',
          injectionMode: 'auto',
          title: 'Find the heir',
          description: null,
        },
      ],
      alwaysEntities: [],
      alwaysLore: [],
      alwaysThreads: [],
      seatedIds: new Set<string>(),
    },
    bundles: {
      entities: { ...emptyBundle, selected },
      lore: emptyBundle,
      happenings: emptyBundle,
      threads: emptyBundle,
      chapters: emptyBundle,
    },
    queries: { q1: spec, q2: spec, q3: spec, presence: [false, false, false], embedTexts: [] },
    staleCounts: { entities: 0, lore: 0, happenings: 0, threads: 0, chapters: 0 },
    injectedAwarenessIds: [],
    selectedLocationIds: over.selectedLocationIds ?? [],
    timings: { totalMs: 0, syncMs: 0, embedMs: 0, knnMs: 0, rankMs: 0 },
  }
}

async function runNarrativeWith(opts: {
  narrative: string
  settings?: Partial<StorySettings>
  log?: Logger
  intermediates?: Record<string, unknown>
}) {
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition,
    settings: baseSettings({
      partialChapterBuffer: 3,
      piggybackMode: 'on',
      suggestionsEnabled: true,
      suggestionCount: 2,
      suggestionCategories: SUGGESTION_CATEGORIES,
      ...opts.settings,
    }),
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
  } as never)
  streamTextMock.mockReturnValue({
    ok: true,
    modelId: 'model-1',
    providerId: 'prov-1',
    stream: {
      fullStream: (async function* () {
        yield { type: 'text-delta', text: opts.narrative }
      })(),
    },
  })

  ensurePerTurnPipelineRegistered()
  const phase = getPipeline(PER_TURN_KIND).phases[2]
  if (!phase || !('run' in phase)) throw new Error('expected narrative phase')
  const intermediates: Record<string, unknown> = { ...opts.intermediates }
  const gen = phase.run({
    actionId: 'act_1',
    abortSignal: new AbortController().signal,
    intermediates,
    log: opts.log ?? makeLogger('act_1'),
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
  const created = events.find(
    (e) => e.type === 'delta_emitted' && e.action.kind === 'createStoryEntry',
  )
  if (!created || created.type !== 'delta_emitted' || created.action.kind !== 'createStoryEntry')
    throw new Error('expected a createStoryEntry delta')
  const { metadata } = created.action.payload.entry
  if (!metadata) throw new Error('expected entry metadata')
  return {
    events,
    metadata,
    intermediates,
    prompt: streamTextMock.mock.calls.at(-1)?.[1]?.prompt as string,
    context: renderTemplateMock.mock.calls.at(-1)?.[1] as Record<string, unknown>,
  }
}

describe('narrative fold — retrieval handoff', () => {
  const namesOf = (bucket: unknown) =>
    (bucket as { displayName: string }[]).map((r) => r.displayName)

  it('passes the stashed retrieval outcome into the generation context', async () => {
    const { context } = await runNarrativeWith({
      narrative: 'prose',
      intermediates: { [RETRIEVAL_INTERMEDIATE_KEY]: retrievalIntermediate() },
    })
    expect(namesOf(context.retrievedEntities)).toEqual(['Corvin'])
    expect((context.structuralActiveThreads as { title: string }[]).map((t) => t.title)).toEqual([
      'Find the heir',
    ])
  })

  // The negative control for the case above: same fold, no intermediate.
  it('renders empty buckets when the retrieval phase stashed nothing', async () => {
    const { context } = await runNarrativeWith({ narrative: 'prose' })
    expect(context.retrievedEntities).toEqual([])
    expect(context.structuralActiveThreads).toEqual([])
  })

  // The whole round trip for a scene that MOVES: the ranked place has to reach
  // the prompt as a nameable ID, and what the model names has to land on the
  // entry. Omitting <current_location> means "inherit" (lib/piggyback/apply.ts),
  // so a prompt that offers no place freezes the location forever.
  it('lets the model move the scene to a ranked location', async () => {
    const { prompt, metadata } = await runNarrativeWith({
      narrative:
        'They cross to the stalls.\n<state><current_location>l1</current_location></state>',
      intermediates: {
        [RETRIEVAL_INTERMEDIATE_KEY]: retrievalIntermediate({
          entities: [
            entityCandidate(
              RETRIEVED_LOCATION_ID,
              'The Market',
              'The Market (currently elsewhere): stalls under sailcloth.',
            ),
          ],
          selectedLocationIds: [RETRIEVED_LOCATION_ID],
        }),
      },
    })
    expect(prompt).toContain('for <current_location> when the scene is at that place: l1.')
    expect(metadata.currentLocationId).toBe(RETRIEVED_LOCATION_ID)
  })

  // Negative control for the case above: the same fold with a ranked CHARACTER
  // offers no place, so the instruction stays out of the prompt entirely.
  it('offers no <current_location> target when the ranked entity is not a place', async () => {
    const { prompt } = await runNarrativeWith({
      narrative: 'prose',
      intermediates: { [RETRIEVAL_INTERMEDIATE_KEY]: retrievalIntermediate() },
    })
    expect(prompt).toContain('Corvin (currently elsewhere): a smuggler.')
    expect(prompt).not.toContain('for <current_location> when the scene is at that place')
  })

  // ctx.intermediates is Record<string, unknown>: a non-outcome value must not
  // reach the builder as if it were one.
  it('ignores a value parked under the retrieval key that is not an ok outcome', async () => {
    const { context } = await runNarrativeWith({
      narrative: 'prose',
      intermediates: { [RETRIEVAL_INTERMEDIATE_KEY]: { ok: false, failure: { reason: 'call' } } },
    })
    expect(context.retrievedEntities).toEqual([])
  })
})

describe('narrative fold — suggestions', () => {
  it('persists parsed chips with source piggyback on the created entry', async () => {
    const { metadata, prompt } = await runNarrativeWith({
      narrative:
        'The rain falls.\n<state><summary>rain</summary></state>\n' +
        '<suggestions><item category="cat1">Draw the blade.</item>' +
        '<item category="cat2">"Who sent you?"</item></suggestions>',
    })
    expect(prompt).toContain('<suggestions>')
    expect(metadata.nextTurnSuggestions).toEqual({
      items: [
        { categoryId: 'cat_action', text: 'Draw the blade.' },
        { categoryId: 'cat_dialogue', text: '"Who sent you?"' },
      ],
      source: 'piggyback',
    })
  })

  it('persists chips even when the sibling <state> block fails to parse', async () => {
    const { metadata, intermediates } = await runNarrativeWith({
      // visual_changes truncated (no closing </entity>) — the same shape as
      // the existing per-turn-piggyback malformed-block coverage.
      narrative:
        'Narrative text\n<state><scene_entities>char_1</scene_entities>' +
        '<visual_changes><entity id="char_1" type="attire">torn cloak</state>\n' +
        '<suggestions><item category="cat1">kept</item></suggestions>',
    })
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(metadata.nextTurnSuggestions).toEqual({
      items: [{ categoryId: 'cat_action', text: 'kept' }],
      source: 'piggyback',
    })
  })

  it('drops an item whose category ref does not resolve, keeping the rest', async () => {
    const { metadata } = await runNarrativeWith({
      narrative:
        'p\n<state><summary>s</summary></state>\n' +
        '<suggestions><item category="cat9">orphan</item>' +
        '<item category="cat1">kept</item></suggestions>',
    })
    expect(metadata.nextTurnSuggestions?.items).toEqual([
      { categoryId: 'cat_action', text: 'kept' },
    ])
  })

  it('logs classifier.suggestions_parse_failed with the drop count on a partial resolve', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    await runNarrativeWith({
      log: logger,
      narrative:
        'p\n<state><summary>s</summary></state>\n' +
        '<suggestions><item category="cat9">orphan</item>' +
        '<item category="cat1">kept</item></suggestions>',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'classifier.suggestions_parse_failed',
      expect.objectContaining({ dropped: 1 }),
    )
  })

  // The silent case before malformedCount existed: the bad item never reaches
  // `items`, so droppedCount is 0, and one good chip makes captured true — the
  // old gate gave a half-filled strip and no signal at all.
  it('warns when the model under-delivers because an item was malformed', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    await runNarrativeWith({
      log: logger,
      narrative:
        'p\n<state><summary>s</summary></state>\n' +
        '<suggestions><item>no category</item>' +
        '<item category="cat1">kept</item></suggestions>',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'classifier.suggestions_parse_failed',
      expect.objectContaining({ dropped: 0, malformed: 1, resolved: 1, expected: 2 }),
    )
  })

  // The producer half of the handoff the classifier fold reads to decide
  // askForSuggestions. Consumer tests inject this value as a fixture, so
  // without these the write could be deleted outright and the suite stay green
  // — and a <state>-failed turn would re-roll and clobber landed chips.
  describe('publishes suggestionsCaptured for the classifier fold', () => {
    it('is true when chips resolved', async () => {
      const { intermediates } = await runNarrativeWith({
        narrative:
          'p\n<state><summary>s</summary></state>\n' +
          '<suggestions><item category="cat1">kept</item></suggestions>',
      })
      expect(intermediates.suggestionsCaptured).toBe(true)
    })

    it('is false when the block failed to parse', async () => {
      const { intermediates } = await runNarrativeWith({
        narrative: 'p\n<state><summary>s</summary></state>\n<suggestions>garbage</suggestions>',
      })
      expect(intermediates.suggestionsCaptured).toBe(false)
    })

    it('is false when every ref dropped', async () => {
      const { intermediates } = await runNarrativeWith({
        narrative:
          'p\n<state><summary>s</summary></state>\n' +
          '<suggestions><item category="cat9">orphan</item></suggestions>',
      })
      expect(intermediates.suggestionsCaptured).toBe(false)
    })

    it('is false when suggestions are disabled', async () => {
      const { intermediates } = await runNarrativeWith({
        settings: { suggestionsEnabled: false },
        narrative: 'p\n<state><summary>s</summary></state>',
      })
      expect(intermediates.suggestionsCaptured).toBe(false)
    })
  })

  it('clamps persisted chips to suggestionCount when the model over-emits', async () => {
    const { metadata } = await runNarrativeWith({
      // Base fixture settings set suggestionCount: 2; three valid items come back.
      narrative:
        'p\n<state><summary>s</summary></state>\n' +
        '<suggestions><item category="cat1">one</item>' +
        '<item category="cat2">two</item>' +
        '<item category="cat1">three</item></suggestions>',
    })
    expect(metadata.nextTurnSuggestions?.items).toEqual([
      { categoryId: 'cat_action', text: 'one' },
      { categoryId: 'cat_dialogue', text: 'two' },
    ])
  })

  it('leaves nextTurnSuggestions undefined when the block fails to parse', async () => {
    const { metadata } = await runNarrativeWith({
      narrative: 'p\n<state><summary>s</summary></state>\n<suggestions>garbage</suggestions>',
    })
    expect(metadata.nextTurnSuggestions).toBeUndefined()
    expect(metadata.summary).toBe('s')
  })

  it('omits the fragment and writes nothing when suggestions are disabled', async () => {
    const { metadata, prompt } = await runNarrativeWith({
      settings: { suggestionsEnabled: false },
      narrative: 'p\n<state><summary>s</summary></state>',
    })
    expect(metadata.nextTurnSuggestions).toBeUndefined()
    expect(prompt).not.toContain('<suggestions>')
  })

  it('does not request suggestions when the state block is not requested either', async () => {
    const { prompt } = await runNarrativeWith({
      settings: { piggybackMode: 'off' },
      narrative: 'p',
    })
    expect(prompt).not.toContain('<suggestions>')
  })
})
