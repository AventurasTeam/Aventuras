import { APICallError } from 'ai'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { reverseAndPruneDeltaRows } from '@/lib/actions/delta/reverse-replay'
import { resolveSweep } from '@/lib/actions/story-entries/operational'
import { undoLastAction } from '@/lib/actions/story-entries/undo'
import {
  ContextWindowError,
  type CapabilityHint,
  type ContextWindowFailure,
  type generateStructured,
  type GenerationWindow,
  type streamText,
  type StreamTextResult,
} from '@/lib/ai'
import {
  APP_SETTINGS_DEFAULTS,
  deltas,
  emptyEntityState,
  entities,
  STORY_SETTINGS_DEFAULTS,
  storyEntries,
  type Entity,
  type EntryMetadata,
  type StorySettings,
} from '@/lib/db'
import { logger, makeLogger, type Logger } from '@/lib/diagnostics'
import { spyLogger } from '@/lib/diagnostics/__tests__/spy-logger'
import { IdBiMap } from '@/lib/ids'
import type { RenderedPrompt, TemplateId } from '@/lib/prompts'
import type { Candidate, RetrievalSuccess } from '@/lib/retrieval'
import { retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'
import { appSettingsStore, currentStoryStore, entitiesStore, resetAllStores } from '@/lib/stores'
import { emptyEntityView } from '@/lib/world'

import { createPhaseDb, hydrateEntries, resetPhaseDb, type PhaseDb } from './__tests__/phase-db'
import { __resetClassifierEmbedder, configureClassifierEmbedder } from './description-embedder'
import { RETRIEVAL_INTERMEDIATE_KEY } from './intermediates'
import { nextMemoryRun } from './memory-chain'
import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './per-turn'
import { fallbackClassifierSchema } from './per-turn-piggyback'
import { getPipeline } from '../authoring/registry'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

const { streamTextMock, renderTemplateMock, generateStructuredMock } = vi.hoisted(() => ({
  // The fake streams stand in for the SDK's result shape; streamCall pins the rest to the facade.
  streamTextMock:
    vi.fn<
      (
        ...args: Parameters<typeof streamText>
      ) => ReturnType<typeof streamCall> | Extract<StreamTextResult, { ok: false }>
    >(),
  renderTemplateMock: vi.fn(),
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    streamText: streamTextMock,
    generateStructured: generateStructuredMock,
  }
})

// Records the context each phase hands over, then renders for real — the
// generation context is the only place a retrieval bundle is observable until
// the bundled pack renders one.
vi.mock('@/lib/prompts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const render = actual.renderTemplate as (
    id: TemplateId,
    ctx: Record<string, unknown>,
  ) => RenderedPrompt
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

type StreamCall = Extract<StreamTextResult, { ok: true }>

/** streamText's ok arm around a fake stream: an unknown window, no estimate, no window failure, no hint. */
function streamCall(
  fake: Partial<Omit<StreamCall, 'ok' | 'stream'>> & { stream: object },
): Omit<StreamCall, 'stream'> & { stream: object } {
  return {
    ok: true,
    modelId: 'model-1',
    providerId: 'prov-1',
    timedOut: () => false,
    timeoutMs: undefined,
    maxOutput: undefined,
    window: { tokens: null, source: 'unknown' },
    promptEstimate: () => null,
    contextWindowFailureOf: () => null,
    capabilityHintOf: () => undefined,
    ...fake,
  }
}

function failingStreamCall() {
  return streamCall({
    stream: {
      fullStream: (async function* () {
        throw new Error('stop after call')
      })(),
    },
  })
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
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
  })
  let next = await gen.next()
  while (!next.done) next = await gen.next()
  return next.value
}

let phaseDb: PhaseDb

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

beforeEach(() => {
  vi.restoreAllMocks()
  streamTextMock.mockReset().mockReturnValue(failingStreamCall())
  renderTemplateMock.mockReset()
  generateStructuredMock.mockReset()
  resetAllStores()
  resetPhaseDb(phaseDb)
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
    expect(p.concurrencyPolicy.blockedBy).toEqual([
      'per-turn',
      'periodic-classifier',
      'chapter-close',
    ])
    expect(p.chainsTo).toBe(nextMemoryRun)
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
      db: phaseDb.db,
      runInTransaction: async () => undefined,
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
      settings: baseSettings({
        partialChapterBuffer: 3,
        models: { narrative: { providerId: 'prov-1', modelId: 'story-model' } },
      }),
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
        config: expect.objectContaining({
          storyModels: { narrative: { providerId: 'prov-1', modelId: 'story-model' } },
        }),
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
      error: { kind: 'orchestrator', detail: 'narrative: no open story for branch' },
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
    hydrateEntries(phaseDb, 'b-other', [])

    const result = await runNarrativePhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: 'narrative: entries store loaded for another branch',
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
    hydrateEntries(phaseDb, 'b1', [])
    entitiesStore.hydrate('b1', [])
    const controller = new AbortController()
    // ai@6 fullStream ends without throwing on abort (an 'abort' part, no
    // onError) — the phase must classify via the signal, not a stream error.
    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            controller.abort()
          })(),
        },
      }),
    )

    const result = await runNarrativePhase(controller.signal)

    expect(result).toEqual({ status: 'aborted' })
  })

  // The profile's timeout ends the stream the same graceful way, and what arrived is no reply.
  it('fails as a provider timeout when the timeout ends the stream', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3 }),
    })
    hydrateEntries(phaseDb, 'b1', [])
    entitiesStore.hydrate('b1', [])
    streamTextMock.mockReturnValue(
      streamCall({
        timedOut: () => true,
        timeoutMs: 45_000,
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'The lantern gutt' }
          })(),
        },
      }),
    )

    const result = await runNarrativePhase()

    // The orchestrator's failure logs carry only the kind and the detail.
    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'provider', reason: 'timeout', detail: 'narrative: timeout after 45000ms' },
    })
  })

  // The SDK reports an error part and reads on, so a stall can follow it.
  it('names the stream error a timeout followed', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3 }),
    })
    hydrateEntries(phaseDb, 'b1', [])
    entitiesStore.hydrate('b1', [])
    let expired = false
    streamTextMock.mockImplementation((_target, opts) =>
      streamCall({
        timedOut: () => expired,
        timeoutMs: 45_000,
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'The lantern gutt' }
            opts.onError?.({ error: new Error('upstream overloaded') })
            expired = true
          })(),
        },
      }),
    )

    const result = await runNarrativePhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'provider',
        reason: 'timeout',
        detail: 'narrative: timeout after 45000ms; earlier stream error: upstream overloaded',
      },
    })
  })

  // Native fetch rejects an aborted read with a plain error, which the SDK then reports.
  it("doesn't name the error the timeout's own abort raised", async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3 }),
    })
    hydrateEntries(phaseDb, 'b1', [])
    entitiesStore.hydrate('b1', [])
    let expired = false
    streamTextMock.mockImplementation((_target, opts) =>
      streamCall({
        timedOut: () => expired,
        timeoutMs: 45_000,
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'The lantern gutt' }
            expired = true
            opts.onError?.({ error: new Error('fetch failed: The operation was aborted.') })
          })(),
        },
      }),
    )

    const result = await runNarrativePhase()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'provider', reason: 'timeout', detail: 'narrative: timeout after 45000ms' },
    })
  })

  it('surfaces a resolve failure as a config-resolver phase error', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3 }),
    })
    hydrateEntries(phaseDb, 'b1', [])
    entitiesStore.hydrate('b1', [])
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
    hydrateEntries(phaseDb, 'b1', [])
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
    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield {
              type: 'text-delta',
              text: 'The story begins.\n<state><scene_entities>c1</scene_entities><world_time_delta>15</world_time_delta></state>',
            }
          })(),
        },
      }),
    )

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      runInTransaction: async () => undefined,
      db: phaseDb.db,
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
            // Prose only: the trailing block is parsed and stripped at write time,
            // and what it carried is persisted structurally on stateReport instead.
            content: 'The story begins.',
            metadata: expect.objectContaining({
              sceneEntities: [heroId],
              worldTime: 15,
              stateReport: {
                layer: 'piggyback_tagged_block',
                sceneEntities: [heroId],
                worldTimeDelta: 15,
                // Equal to the emitted value: nothing was clamped, and the panel needs
                // both numbers to tell that apart from a clamp that landed on 15.
                worldTimeDeltaApplied: 15,
              },
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
        payload: { branchId: 'b1', id: heroId, proseEntryId: null },
      },
    })
  })

  it('strips BOTH trailing blocks from the persisted content, not only <state>', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
    })
    hydrateEntries(phaseDb, 'b1', [])
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

    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield {
              type: 'text-delta',
              text:
                'The knight drew his sword.\n' +
                '<state><world_time_delta>30</world_time_delta></state>\n' +
                '<suggestions><item category="cat1">Run.</item></suggestions>',
            }
          })(),
        },
      }),
    )

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      runInTransaction: async () => undefined,
      db: phaseDb.db,
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
    const { content, metadata } = created.action.payload.entry
    expect(content).toBe('The knight drew his sword.')
    expect(content).not.toContain('<state>')
    expect(content).not.toContain('<suggestions>')
    // The stripped state still reached metadata rather than being lost with the markup.
    expect(metadata?.stateReport?.worldTimeDelta).toBe(30)
  })

  // Stripping a block-only reply leaves nothing. A blank row is unrecoverable, so the
  // raw text is persisted instead; the reader strips it again at display.
  it('persists the raw reply when stripping the block would leave no prose', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
    })
    hydrateEntries(phaseDb, 'b1', [])
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

    const raw = '<state><world_time_delta>30</world_time_delta></state>'
    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: raw }
          })(),
        },
      }),
    )

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      runInTransaction: async () => undefined,
      db: phaseDb.db,
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
    expect(created.action.payload.entry.content).toBe(raw)
  })

  it('drops sceneEntities and falls back to the classifier when the model emits an unresolvable placeholder', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
    })
    hydrateEntries(phaseDb, 'b1', [])
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

    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield {
              type: 'text-delta',
              text: 'The story begins.\n<state><scene_entities>c99</scene_entities><world_time_delta>15</world_time_delta></state>',
            }
          })(),
        },
      }),
    )

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      runInTransaction: async () => undefined,
      db: phaseDb.db,
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
    hydrateEntries(phaseDb, 'b1', [])
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

    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield {
              type: 'text-delta',
              text: 'The story begins.\n<state><current_location>l999</current_location></state>',
            }
          })(),
        },
      }),
    )

    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: logger,
      runInTransaction: async () => undefined,
      db: phaseDb.db,
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

  it("clamps negative worldTimeDelta to 0 and logs classifier.delta_clamped on the run's logger", async () => {
    const log = spyLogger()

    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
    })
    hydrateEntries(phaseDb, 'b1', [])
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

    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield {
              type: 'text-delta',
              text: 'Going back in time?\n<state><world_time_delta>-30</world_time_delta></state>',
            }
          })(),
        },
      }),
    )

    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')

    const intermediates: Record<string, unknown> = {}
    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log,
      runInTransaction: async () => undefined,
      db: phaseDb.db,
      storyId: 's1',
      branchId: 'b1',
    })

    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }

    expect(log.warn).toHaveBeenCalledWith(
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
    hydrateEntries(phaseDb, 'b1', [])
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
    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield {
              type: 'text-delta',
              text: 'Narrative text\n<state><scene_entities>char_1</scene_entities><visual_changes><entity id="char_1" type="attire">torn cloak</state>',
            }
          })(),
        },
      }),
    )

    ensurePerTurnPipelineRegistered()
    const narrativeNode = getPipeline(PER_TURN_KIND).phases[2]
    if (!narrativeNode || !('run' in narrativeNode)) throw new Error('expected narrative phase')

    const intermediates: Record<string, unknown> = {}
    const gen = narrativeNode.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      runInTransaction: async () => undefined,
      db: phaseDb.db,
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
      db: phaseDb.db,
      runInTransaction: async () => undefined,
      storyId: 's1',
      branchId: 'b1',
    })

    const fallbackResult = await fallbackGen.next()
    expect(fallbackResult).toEqual({ done: true, value: { status: 'completed' } })
  })

  // An empty block used to satisfy `blockFound && !failures`, which marked the turn a
  // clean parse, suppressed the fallback, and left the row with no stateReport at all.
  it('treats an empty <state> block as a failed parse and keeps the raw block as evidence', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
    })
    hydrateEntries(phaseDb, 'b1', [])
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

    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'Narrative text\n<state></state>' }
          })(),
        },
      }),
    )

    ensurePerTurnPipelineRegistered()
    const narrativeNode = getPipeline(PER_TURN_KIND).phases[2]
    if (!narrativeNode || !('run' in narrativeNode)) throw new Error('expected narrative phase')

    const intermediates: Record<string, unknown> = {}
    const gen = narrativeNode.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      runInTransaction: async () => undefined,
      db: phaseDb.db,
      storyId: 's1',
      branchId: 'b1',
    })
    const events = []
    let next = await gen.next()
    while (!next.done) {
      events.push(next.value)
      next = await gen.next()
    }

    // succeeded: false is what lets shouldFallbackFire admit the recovery phase.
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })

    const created = events.find(
      (e) => e.type === 'delta_emitted' && e.action.kind === 'createStoryEntry',
    )
    if (!created || created.type !== 'delta_emitted' || created.action.kind !== 'createStoryEntry')
      throw new Error('expected a createStoryEntry delta')
    const { metadata } = created.action.payload.entry
    expect(metadata?.stateReport?.failedFields).toEqual([
      { field: 'state', detail: 'block was empty or truncated at the open tag' },
    ])
    // content no longer carries the markup, so the report is the only remaining copy.
    expect(metadata?.stateReport?.raw).toBe('<state></state>')
  })

  // Omitting the block entirely is the one failure parseStateBlock cannot name on its
  // own — blockFound: false is also what a piggyback-off turn looks like. Unrecorded,
  // the fallback's recovery is indistinguishable from a story that never asked.
  it('records a block-level failure when a capable model emits no <state> at all', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3, piggybackMode: 'on' }),
    })
    hydrateEntries(phaseDb, 'b1', [])
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

    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'Narrative text and nothing else.' }
          })(),
        },
      }),
    )

    ensurePerTurnPipelineRegistered()
    const narrativeNode = getPipeline(PER_TURN_KIND).phases[2]
    if (!narrativeNode || !('run' in narrativeNode)) throw new Error('expected narrative phase')

    const intermediates: Record<string, unknown> = {}
    const gen = narrativeNode.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger('act_1'),
      runInTransaction: async () => undefined,
      db: phaseDb.db,
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

    const created = events.find(
      (e) => e.type === 'delta_emitted' && e.action.kind === 'createStoryEntry',
    )
    if (!created || created.type !== 'delta_emitted' || created.action.kind !== 'createStoryEntry')
      throw new Error('expected a createStoryEntry delta')
    const { metadata } = created.action.payload.entry
    expect(metadata?.stateReport?.layer).toBe('piggyback_tagged_block')
    expect(metadata?.stateReport?.failedFields).toEqual([
      { field: 'state', detail: 'no <state> block in the reply' },
    ])
    // No block, so nothing was stripped and there is no raw remnant to keep.
    expect(metadata?.stateReport?.raw).toBeUndefined()
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
    entity: {
      kind: 'character',
      name: displayName,
      description: null,
      status: 'active',
      state: emptyEntityView('character'),
    },
  }
}

function happeningCandidate(id: string, title: string): Candidate {
  return {
    kind: 'happening',
    id,
    displayName: title,
    renderedText: `${title}.`,
    sims: [0, 0, 0],
    vector: new Float32Array([1, 0, 0]),
    chaptersOld: 0,
    pinSignal: 0,
    keywordHits: [],
    embeddingStale: false,
    commonKnowledge: false,
    occurredAtEntryId: null,
    awarenessIds: [],
  }
}

function retrievalIntermediate(
  over: { entities?: Candidate[]; happenings?: Candidate[]; selectedLocationIds?: string[] } = {},
): RetrievalSuccess {
  return retrievalSuccess({
    floor: {
      activeThreads: [
        {
          id: 'thr_00000000-0000-4000-8000-0000000000f9',
          status: 'active',
          injectionMode: 'auto',
          title: 'Find the heir',
          description: null,
        },
      ],
    },
    selected: {
      entities: over.entities ?? [
        entityCandidate(RETRIEVED_ENTITY_ID, 'Corvin', 'Corvin (not in the scene): a smuggler.'),
      ],
      happenings: over.happenings ?? [],
    },
    selectedLocationIds: over.selectedLocationIds,
  })
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
  hydrateEntries(phaseDb, 'b1', [])
  // The store carries the whole branch in production (openStory hydrates it
  // unwindowed), and buildPiggybackActions resolves <current_location> against
  // it — so a ranked location has to exist here, not only in the retrieval
  // intermediate, or the fold refuses an id the prompt just offered.
  entitiesStore.hydrate('b1', [
    {
      id: RETRIEVED_LOCATION_ID,
      branchId: 'b1',
      kind: 'location',
      name: 'The Market',
      description: 'stalls under sailcloth.',
      status: 'active',
      injectionMode: 'auto',
    },
  ] as never)
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
  streamTextMock.mockReturnValue(
    streamCall({
      stream: {
        fullStream: (async function* () {
          yield { type: 'text-delta', text: opts.narrative }
        })(),
      },
    }),
  )

  ensurePerTurnPipelineRegistered()
  const phase = getPipeline(PER_TURN_KIND).phases[2]
  if (!phase || !('run' in phase)) throw new Error('expected narrative phase')
  const intermediates: Record<string, unknown> = { ...opts.intermediates }
  const gen = phase.run({
    actionId: 'act_1',
    abortSignal: new AbortController().signal,
    intermediates,
    log: opts.log ?? makeLogger('act_1'),
    runInTransaction: async () => undefined,
    db: phaseDb.db,
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
  const halves = streamTextMock.mock.calls.at(-1)![1].prompt
  return {
    events,
    metadata,
    intermediates,
    prompt: halves.user,
    system: halves.system,
    context: renderTemplateMock.mock.calls.at(-1)?.[1] as Record<string, unknown>,
  }
}

describe('narrative call prompt', () => {
  // architecture.md → System and user halves: always asked; only anthropic providers honour it.
  it('asks the narrative call to mark its system prefix for caching', async () => {
    await runNarrativeWith({ narrative: 'prose' })

    expect(streamTextMock.mock.calls.at(-1)?.[1]?.cacheSystemPrefix).toBe(true)
  })
})

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

  // Round trip for a scene that MOVES: omitting <current_location> means "inherit"
  // (lib/piggyback/apply.ts), so a prompt that offers no place freezes the location forever.
  it('lets the model move the scene to a place on the map that retrieval never ranked', async () => {
    const { prompt, metadata } = await runNarrativeWith({
      narrative:
        'They cross to the stalls.\n<state><current_location>l1</current_location></state>',
    })
    expect(prompt).toContain('# Places\n[l1] The Market\n')
    expect(prompt).toContain('Use an ID from Places for <current_location>')
    expect(metadata.currentLocationId).toBe(RETRIEVED_LOCATION_ID)
  })

  it('builds locationIds for custom packs while the bundled template offers places through the map', async () => {
    const { prompt, context } = await runNarrativeWith({
      narrative: 'prose',
      intermediates: {
        [RETRIEVAL_INTERMEDIATE_KEY]: retrievalIntermediate({
          entities: [
            entityCandidate(
              RETRIEVED_LOCATION_ID,
              'The Market',
              'The Market (not in the scene): stalls under sailcloth.',
            ),
          ],
          selectedLocationIds: [RETRIEVED_LOCATION_ID],
        }),
      },
    })
    expect(context.locationIds).toEqual(['l1'])
    expect(prompt).toContain('# Places\n[l1] The Market\n')
    expect(prompt).not.toContain('Use one of these place IDs')
  })

  // data-model.md → Entry metadata shape: the periodic classifier lists what the turn was given.
  it('records the happenings the ranker seated on the reply, by id', async () => {
    const { metadata } = await runNarrativeWith({
      narrative: 'prose',
      intermediates: {
        [RETRIEVAL_INTERMEDIATE_KEY]: retrievalIntermediate({
          happenings: [
            happeningCandidate('hap_00000000-0000-4000-8000-0000000000a1', 'The ford'),
            happeningCandidate('hap_00000000-0000-4000-8000-0000000000a2', 'The fire'),
          ],
        }),
      },
    })
    expect(metadata.injectedHappenings).toEqual([
      'hap_00000000-0000-4000-8000-0000000000a1',
      'hap_00000000-0000-4000-8000-0000000000a2',
    ])
  })

  it.each([
    ['the ranker seated none', { [RETRIEVAL_INTERMEDIATE_KEY]: retrievalIntermediate() }],
    ['the retrieval phase stashed nothing', {}],
  ])('records no happenings on the reply when %s', async (_name, intermediates) => {
    const { metadata } = await runNarrativeWith({ narrative: 'prose', intermediates })
    expect(metadata).not.toHaveProperty('injectedHappenings')
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

  // Both directions: the SAME block must yield a report when this phase applies it and
  // none when it does not, or the badge names an agent that supplied nothing.
  it('writes no state report when piggyback is off and the model emits a block anyway', async () => {
    // A reportable field, not just <summary>: buildStateReport drops summary by design.
    const narrative = 'p\n<state><world_time_delta>30</world_time_delta></state>'

    const off = await runNarrativeWith({ settings: { piggybackMode: 'off' }, narrative })
    expect(off.metadata.stateReport).toBeUndefined()

    const on = await runNarrativeWith({ narrative })
    expect(on.metadata.stateReport?.layer).toBe('piggyback_tagged_block')
    expect(on.metadata.stateReport?.worldTimeDelta).toBe(30)
  })
})

describe('narrative fold — creates', () => {
  const HERO = 'char_00000000-0000-4000-8000-000000000001'
  const TOWN = 'loc_00000000-0000-4000-8000-0000000000a1'
  const MARKET = 'loc_00000000-0000-4000-8000-0000000000a2'
  const OLD_KEY = 'item_00000000-0000-4000-8000-0000000000b1'
  const TURN_ACTION = 'act_turn'
  const USER_ACTION_ID = 'entry_action'
  const SCENE: EntryMetadata = { sceneEntities: [HERO], currentLocationId: TOWN, worldTime: 0 }

  // c1 is HERO and l1 is TOWN (seeded in foldTurn).
  const CREATE_REPLY =
    'The tide pulls Aria down to the water.\n<state><scene_entities>c1</scene_entities>' +
    '<new_location handle="new:docks" parent="l1" name="Smuggler Docks">a rotting pier below the cliffs</new_location>' +
    '<current_location>new:docks</current_location>' +
    '<new_item handle="new:key" name="rusted key">an iron key, flaked with rust</new_item>' +
    '<transfers><item id="new:key" to="c1" slot="inventory" /></transfers>' +
    '<world_time_delta>60</world_time_delta></state>'

  // Built per case: undo and regenerate reverse a real delta log.
  let turnDb: PhaseDb
  const turnCtx = () => ({ db: turnDb.db, runInTransaction: turnDb.runInTransaction })

  beforeEach(async () => {
    turnDb = await createPhaseDb()
    __resetClassifierEmbedder()
  })

  function worldRow(row: Pick<Entity, 'id' | 'kind' | 'name'> & Partial<Entity>): Entity {
    return {
      branchId: 'b1',
      description: null,
      status: 'active',
      retiredReason: null,
      injectionMode: 'auto',
      nameCollisionFlag: 0,
      nameCollisionPartnerId: null,
      nameCollisionReason: null,
      state: emptyEntityState(row.kind),
      tags: [],
      keywords: [],
      priority: 0,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
      ...row,
    }
  }

  const baseWorld = (): Entity[] => [
    worldRow({
      id: HERO,
      kind: 'character',
      name: 'Aria',
      state: { ...emptyEntityState('character'), current_location_id: TOWN },
    }),
    worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
    worldRow({
      id: MARKET,
      kind: 'location',
      name: 'The Drowned Market',
      state: { parent_location_id: TOWN },
    }),
  ]

  // An opening, then this turn's user_action committed under TURN_ACTION, as submitTurn does.
  async function seedTurn(
    world: Entity[] = baseWorld(),
    actionScene: EntryMetadata = SCENE,
  ): Promise<void> {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({
        partialChapterBuffer: 3,
        piggybackMode: 'on',
        suggestionsEnabled: false,
      }),
    })
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
    await turnDb.db.insert(entities).values(world)
    entitiesStore.hydrate('b1', world)
    hydrateEntries(turnDb, 'b1', [
      {
        id: 'entry_opening',
        branchId: 'b1',
        position: 1,
        kind: 'opening',
        content: 'The tide is out at Saltmere.',
        chapterId: null,
        metadata: SCENE,
        createdAt: 1,
      },
    ])
    const seeded = await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'user_edit',
          payload: {
            entry: {
              id: USER_ACTION_ID,
              branchId: 'b1',
              position: 2,
              kind: 'user_action',
              content: 'I go down to the water.',
              chapterId: null,
              metadata: actionScene,
              createdAt: 2,
            },
          },
        },
        actionId: TURN_ACTION,
        branchId: 'b1',
        entryId: null,
      },
      turnCtx(),
    )
    if (seeded.status !== 'ok') throw new Error(`seed rejected: ${seeded.reason}`)
  }

  function phaseCtx(
    intermediates: Record<string, unknown>,
    over: { signal?: AbortSignal; log?: Logger } = {},
  ): PhaseContext {
    return {
      actionId: TURN_ACTION,
      abortSignal: over.signal ?? new AbortController().signal,
      intermediates,
      log: over.log ?? makeLogger(TURN_ACTION),
      db: turnDb.db,
      runInTransaction: turnDb.runInTransaction,
      storyId: 's1',
      branchId: 'b1',
    }
  }

  function phaseAt(index: 2 | 3) {
    ensurePerTurnPipelineRegistered()
    const node = getPipeline(PER_TURN_KIND).phases[index]
    if (!node || !('run' in node)) throw new Error(`expected a single-run phase at ${index}`)
    return node.run
  }

  async function drain(gen: AsyncGenerator<PhaseEmittedEvent, PhaseResult>) {
    const events: PhaseEmittedEvent[] = []
    let next = await gen.next()
    while (!next.done) {
      events.push(next.value)
      next = await gen.next()
    }
    return { events, result: next.value }
  }

  async function foldTurn(text: string, over: { signal?: AbortSignal; log?: Logger } = {}) {
    streamTextMock.mockReturnValue(
      streamCall({
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text }
          })(),
        },
      }),
    )
    const idMap = new IdBiMap()
    for (const id of [HERO, TOWN, MARKET]) idMap.allocate(id)
    const intermediates: Record<string, unknown> = { idMap }
    const { events, result } = await drain(phaseAt(2)(phaseCtx(intermediates, over)))
    return { events, result, intermediates }
  }

  // The orchestrator applies each delta as it is yielded, and skips a noop (orchestrator.ts).
  async function applyEvents(events: readonly PhaseEmittedEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type !== 'delta_emitted') continue
      const result = await applyDeltaAction(
        {
          action: event.action,
          actionId: TURN_ACTION,
          branchId: 'b1',
          entryId: event.entryId ?? null,
        },
        turnCtx(),
      )
      if (result.status === 'rejected' && result.code !== 'noop')
        throw new Error(`${event.action.kind} rejected: ${result.reason}`)
    }
  }

  const createdEntities = (events: readonly PhaseEmittedEvent[]) =>
    events.flatMap((e) =>
      e.type === 'delta_emitted' && e.action.kind === 'createEntity'
        ? [e.action.payload.entry]
        : [],
    )

  function replyOf(events: readonly PhaseEmittedEvent[]) {
    const created = events.find(
      (e) => e.type === 'delta_emitted' && e.action.kind === 'createStoryEntry',
    )
    if (!created || created.type !== 'delta_emitted' || created.action.kind !== 'createStoryEntry')
      throw new Error('expected a createStoryEntry delta')
    return created.action.payload.entry
  }

  const branchRows = () => turnDb.db.select().from(entities).where(eq(entities.branchId, 'b1'))

  async function storedEntry(id: string) {
    const [row] = await turnDb.db.select().from(storyEntries).where(eq(storyEntries.id, id))
    return row
  }

  it('creates the new place and item, and moves the scene and the hero there', async () => {
    await seedTurn()
    const { events, intermediates } = await foldTurn(CREATE_REPLY)
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: true })
    await applyEvents(events)

    const [docks, key] = createdEntities(events)
    if (!docks || !key) throw new Error('expected a location create and an item create')
    const rows = await branchRows()
    expect(rows.find((r) => r.id === docks.id)).toMatchObject({
      kind: 'location',
      name: 'Smuggler Docks',
      description: 'a rotting pier below the cliffs',
      status: 'active',
      state: { parent_location_id: TOWN },
    })
    expect(rows.find((r) => r.id === key.id)).toMatchObject({
      kind: 'item',
      name: 'rusted key',
      state: { at_location_id: null },
    })
    expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
      current_location_id: docks.id,
      inventory: [key.id],
    })

    const reply = await storedEntry(replyOf(events).id)
    expect(reply?.metadata?.currentLocationId).toBe(docks.id)
    expect(reply?.metadata?.stateReport).toMatchObject({
      currentLocation: docks.id,
      transfers: { items: [{ id: key.id, to: HERO, slot: 'inventory' }], stackables: [] },
      newLocations: [
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier below the cliffs',
          parent: TOWN,
          outcome: 'created',
          id: docks.id,
        },
      ],
      newItems: [
        {
          handle: 'new:key',
          name: 'rusted key',
          description: 'an iron key, flaked with rust',
          outcome: 'created',
          id: key.id,
        },
      ],
    })
  })

  // Creates sit right after the reply's create, so a regenerate's sweep from it removes them.
  it("logs the creates right after the reply's create and before the writes naming them", async () => {
    await seedTurn()
    const { events } = await foldTurn(CREATE_REPLY)
    await applyEvents(events)
    const [docks, key] = createdEntities(events)

    const log = await turnDb.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, TURN_ACTION))
      .orderBy(asc(deltas.logPosition))
    expect(log.map((d) => `${d.source}:${d.targetTable}:${d.op}:${d.targetId}`)).toEqual([
      `user_edit:story_entries:create:${USER_ACTION_ID}`,
      `ai_classifier:story_entries:create:${replyOf(events).id}`,
      `piggyback_tagged_block:entities:create:${docks?.id}`,
      `piggyback_tagged_block:entities:create:${key?.id}`,
      `piggyback_tagged_block:entities:update:${HERO}`,
      `piggyback_tagged_block:entities:update:${HERO}`,
    ])
  })

  const UNPLACED_DOCKS = 'loc_00000000-0000-4000-8000-0000000000a3'
  const unplacedDocks = (): Entity =>
    worldRow({
      id: UNPLACED_DOCKS,
      kind: 'location',
      name: 'Smuggler Docks',
      state: { parent_location_id: null, unplaced: true },
    })

  // data-model.md → LocationState shape: a placement may name a created row, so it follows.
  it('reuses and places an unplaced namesake, logging the placement right after the creates', async () => {
    await seedTurn([...baseWorld(), unplacedDocks()])
    const { events } = await foldTurn(CREATE_REPLY)
    await applyEvents(events)

    const created = createdEntities(events)
    expect(created.map((e) => e.kind)).toEqual(['item'])
    const rows = await branchRows()
    expect(rows.find((r) => r.id === UNPLACED_DOCKS)?.state).toEqual({ parent_location_id: TOWN })
    expect(entitiesStore.getById(UNPLACED_DOCKS)?.state).toEqual({ parent_location_id: TOWN })
    expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
      current_location_id: UNPLACED_DOCKS,
    })
    const reply = await storedEntry(replyOf(events).id)
    expect(reply?.metadata?.stateReport?.newLocations).toEqual([
      {
        handle: 'new:docks',
        name: 'Smuggler Docks',
        description: 'a rotting pier below the cliffs',
        parent: TOWN,
        outcome: 'reused',
        id: UNPLACED_DOCKS,
      },
    ])
    const log = await turnDb.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, TURN_ACTION))
      .orderBy(asc(deltas.logPosition))
    expect(log.map((d) => `${d.source}:${d.targetTable}:${d.op}:${d.targetId}`)).toEqual([
      `user_edit:story_entries:create:${USER_ACTION_ID}`,
      `ai_classifier:story_entries:create:${replyOf(events).id}`,
      `piggyback_tagged_block:entities:create:${created[0]?.id}`,
      `piggyback_tagged_block:entities:update:${UNPLACED_DOCKS}`,
      `piggyback_tagged_block:entities:update:${HERO}`,
      `piggyback_tagged_block:entities:update:${HERO}`,
    ])
  })

  it('leaves a reused place unplaced again when the turn is undone', async () => {
    await seedTurn([...baseWorld(), unplacedDocks()])
    const { events } = await foldTurn(CREATE_REPLY)
    await applyEvents(events)
    expect((await branchRows()).find((r) => r.id === UNPLACED_DOCKS)?.state).toEqual({
      parent_location_id: TOWN,
    })

    expect(await undoLastAction('b1', turnCtx())).toEqual({ status: 'ok' })

    const rows = await branchRows()
    expect(rows.find((r) => r.id === UNPLACED_DOCKS)?.state).toEqual({
      parent_location_id: null,
      unplaced: true,
    })
  })

  // data-model.md → Disabled places: a user_action tail can stand in another place than the scene.
  it('leaves a reused place unplaced when the story was in it before the turn', async () => {
    const world = baseWorld().map((e) =>
      e.id === TOWN ? { ...e, injectionMode: 'disabled' as const } : e,
    )
    await seedTurn([...world, unplacedDocks()], { ...SCENE, currentLocationId: UNPLACED_DOCKS })
    const { events } = await foldTurn(CREATE_REPLY)
    expect(
      events.flatMap((e) => (e.type === 'delta_emitted' ? [e.action.kind] : [])),
    ).not.toContain('placeLocation')
    expect(replyOf(events).metadata?.stateReport?.newLocations).toEqual([
      expect.objectContaining({ outcome: 'reused', id: UNPLACED_DOCKS, parentDropped: true }),
    ])
  })

  // piggyback.md → Parent: `top` makes a place top-level, and no parent leaves it unplaced.
  it.each([
    ['top as its', ' parent="top"', { parent_location_id: null }, { parent: 'top' }],
    ['no', '', { parent_location_id: null, unplaced: true }, {}],
  ] as const)(
    'creates a place with %s parent where the tag puts it',
    async (_label, attribute, state, reported) => {
      await seedTurn()
      const { events } = await foldTurn(
        'Aria rows out to the rock.\n<state><scene_entities>c1</scene_entities>' +
          `<new_location handle="new:isle"${attribute} name="Gull Isle">a bare rock</new_location>` +
          '<current_location>new:isle</current_location><world_time_delta>30</world_time_delta></state>',
      )
      await applyEvents(events)

      const [isle] = createdEntities(events)
      expect((await branchRows()).find((r) => r.id === isle?.id)?.state).toEqual(state)
      expect(replyOf(events).metadata?.stateReport?.newLocations).toEqual([
        {
          handle: 'new:isle',
          name: 'Gull Isle',
          description: 'a bare rock',
          ...reported,
          outcome: 'created',
          id: isle?.id,
        },
      ])
    },
  )

  it('reuses an exact sibling instead of creating a second one', async () => {
    await seedTurn()
    const { events } = await foldTurn(
      'Aria ducks under the awnings.\n<state><scene_entities>c1</scene_entities>' +
        '<new_location handle="new:market" parent="l1" name="the drowned market">mud and awnings</new_location>' +
        '<current_location>new:market</current_location><world_time_delta>30</world_time_delta></state>',
    )
    expect(createdEntities(events)).toEqual([])
    const { metadata } = replyOf(events)
    expect(metadata?.currentLocationId).toBe(MARKET)
    expect(metadata?.stateReport?.newLocations).toEqual([
      {
        handle: 'new:market',
        name: 'the drowned market',
        description: 'mud and awnings',
        parent: TOWN,
        outcome: 'reused',
        id: MARKET,
      },
    ])
  })

  // piggyback.md → Matching before creating: reuse goes by the map this prompt showed. Around
  // Saltmere, disabled but the scene's, the market hangs under it, so a top-level namesake is new.
  it('matches against the map built around the scene this prompt read', async () => {
    const [hero, town, market] = baseWorld()
    await seedTurn([hero!, { ...town!, injectionMode: 'disabled' }, market!])
    const { events } = await foldTurn(
      'Aria finds another market.\n<state><scene_entities>c1</scene_entities>' +
        '<new_location handle="new:market" parent="top" name="The Drowned Market">mud</new_location>' +
        '<current_location>new:market</current_location><world_time_delta>30</world_time_delta></state>',
    )
    expect(createdEntities(events)).toEqual([
      expect.objectContaining({ name: 'The Drowned Market', state: { parent_location_id: null } }),
    ])
  })

  it('promotes a staged sibling it reuses as the ancestor of a new current location', async () => {
    await seedTurn([
      worldRow({
        id: HERO,
        kind: 'character',
        name: 'Aria',
        state: { ...emptyEntityState('character'), current_location_id: TOWN },
      }),
      worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
      worldRow({
        id: MARKET,
        kind: 'location',
        name: 'The Drowned Market',
        status: 'staged',
        state: { parent_location_id: TOWN },
      }),
    ])
    const { events } = await foldTurn(
      'Aria wanders to a stall.\n<state><scene_entities>c1</scene_entities>' +
        '<new_location handle="new:market" parent="l1" name="The Drowned Market">awnings</new_location>' +
        '<new_location handle="new:stall" parent="new:market" name="Fishmonger Stall">a salt-crusted counter</new_location>' +
        '<current_location>new:stall</current_location><world_time_delta>5</world_time_delta></state>',
    )
    await applyEvents(events)

    const [stall] = createdEntities(events)
    if (!stall) throw new Error('expected the stall create')
    expect(createdEntities(events)).toHaveLength(1)
    const rows = await branchRows()
    expect(rows.find((r) => r.id === MARKET)?.status).toBe('active')
    expect(rows.find((r) => r.id === stall.id)).toMatchObject({
      name: 'Fishmonger Stall',
      state: { parent_location_id: MARKET },
    })
    expect(replyOf(events).metadata?.currentLocationId).toBe(stall.id)
  })

  // Only the fallback creates on a failed parse: a second create would duplicate the item.
  it('creates nothing on a failed parse and leaves the turn to the fallback', async () => {
    await seedTurn()
    const failing = CREATE_REPLY.replace(
      '<world_time_delta>60</world_time_delta>',
      '<world_time_delta>soon</world_time_delta>',
    )
    const { events, intermediates } = await foldTurn(failing)
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(createdEntities(events)).toEqual([])
    // The transfer named only the dropped item, so no inventory write survives.
    expect(
      events.some((e) => e.type === 'delta_emitted' && e.action.kind === 'updateEntityInventory'),
    ).toBe(false)
    expect(replyOf(events).metadata?.currentLocationId).toBe(TOWN)
    const foldReport = replyOf(events).metadata?.stateReport
    expect(foldReport?.newLocations).toEqual([
      {
        handle: 'new:docks',
        name: 'Smuggler Docks',
        description: 'a rotting pier below the cliffs',
        parent: TOWN,
        outcome: 'dropped',
      },
    ])
    expect(foldReport?.newItems).toEqual([
      {
        handle: 'new:key',
        name: 'rusted key',
        description: 'an iron key, flaked with rust',
        outcome: 'dropped',
      },
    ])
    await applyEvents(events)

    generateStructuredMock.mockResolvedValueOnce({
      status: 'ok',
      recoverable: [],
      value: fallbackClassifierSchema.parse({ sceneEntities: ['c1'], worldTimeDelta: 30 }),
    })
    const fallback = await drain(phaseAt(3)(phaseCtx(intermediates)))
    expect(generateStructuredMock).toHaveBeenCalledTimes(1)
    await applyEvents(fallback.events)

    const rows = await branchRows()
    expect(
      rows
        .filter((r) => r.kind === 'location')
        .map((r) => r.id)
        .sort(),
    ).toEqual([TOWN, MARKET].sort())
    expect(rows.filter((r) => r.kind === 'item')).toEqual([])
    const final = (await storedEntry(replyOf(events).id))?.metadata?.stateReport
    expect(final?.layer).toBe('per_turn_classifier')
    expect(final?.failedFields?.map((f) => f.field)).toContain('worldTimeDelta')
    // A fallback that emits no create keeps the fold's dropped creates on the record.
    expect(final?.newLocations).toEqual(foldReport?.newLocations)
    expect(final?.newItems).toEqual(foldReport?.newItems)
  })

  // Every field parses; the malformed item leaves its handle undeclared, failing the transfer.
  it('creates nothing when only a ref to a malformed create fails', async () => {
    await seedTurn()
    const reply = CREATE_REPLY.replace('name="rusted key"', "name='rusted key'")
    expect(reply).not.toBe(CREATE_REPLY)
    const { events, intermediates } = await foldTurn(reply)
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(createdEntities(events)).toEqual([])
    const report = replyOf(events).metadata?.stateReport
    expect(report?.failedFields?.map((f) => f.field)).toEqual(['transfers'])
    expect(report?.newLocations).toEqual([
      expect.objectContaining({ handle: 'new:docks', outcome: 'dropped' }),
    ])
  })

  // c1 is HERO and l1 is TOWN: neither is an item, nor is the new place.
  it.each([
    ["a new place's handle", 'id="new:docks"'],
    ["an existing place's id", 'id="l1"'],
    ["a character's id", 'id="c1"'],
  ])("fails transfers on %s as a transfer's item, creating nothing", async (_label, id) => {
    await seedTurn()
    const reply = CREATE_REPLY.replace('<item id="new:key"', `<item ${id}`)
    expect(reply).not.toBe(CREATE_REPLY)
    const { events, intermediates } = await foldTurn(reply)
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(createdEntities(events)).toEqual([])
    const report = replyOf(events).metadata?.stateReport
    expect(report?.failedFields).toEqual([
      { field: 'transfers', detail: expect.stringContaining('not an item') },
    ])
  })

  it("fails currentLocation on a new item's handle, creating nothing", async () => {
    await seedTurn()
    const reply = CREATE_REPLY.replace(
      '<current_location>new:docks</current_location>',
      '<current_location>new:key</current_location>',
    )
    expect(reply).not.toBe(CREATE_REPLY)
    const { events, intermediates } = await foldTurn(reply)
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(createdEntities(events)).toEqual([])
    expect(replyOf(events).metadata?.stateReport?.failedFields).toEqual([
      { field: 'currentLocation', detail: expect.stringContaining('not a location') },
    ])
  })

  // The item repeating the place's handle is dropped as malformed, so the transfer names the place.
  it('fails transfers when a place and an item declare the handle it names', async () => {
    await seedTurn()
    const reply = CREATE_REPLY.replace('handle="new:key"', 'handle="new:docks"').replace(
      '<item id="new:key"',
      '<item id="new:docks"',
    )
    const { events, intermediates } = await foldTurn(reply)
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(createdEntities(events)).toEqual([])
    expect(replyOf(events).metadata?.stateReport?.failedFields?.map((f) => f.field)).toEqual([
      'transfers',
    ])
  })

  it('fails a block of creates alone and leaves the turn to the fallback', async () => {
    await seedTurn()
    const { events, intermediates } = await foldTurn(
      'The tide pulls Aria down to the water.\n<state>' +
        '<new_location handle="new:docks" parent="l1" name="Smuggler Docks">a rotting pier</new_location>' +
        '<new_item handle="new:key" name="rusted key">an iron key</new_item></state>',
    )
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(createdEntities(events)).toEqual([])
    const report = replyOf(events).metadata?.stateReport
    expect(report?.failedFields).toEqual([{ field: 'state', detail: 'block held only creates' }])
    expect(report?.newLocations).toEqual([
      expect.objectContaining({ handle: 'new:docks', outcome: 'dropped' }),
    ])
    expect(report?.newItems).toEqual([
      expect.objectContaining({ handle: 'new:key', outcome: 'dropped' }),
    ])
  })

  it('removes the new rows when the turn is undone', async () => {
    await seedTurn()
    const { events } = await foldTurn(CREATE_REPLY)
    await applyEvents(events)
    const created = createdEntities(events).map((e) => e.id)
    expect(created).toHaveLength(2)

    expect(await undoLastAction('b1', turnCtx())).toEqual({ status: 'ok' })

    const rows = await branchRows()
    expect(rows.filter((r) => created.includes(r.id))).toEqual([])
    expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
      current_location_id: TOWN,
      inventory: [],
    })
    expect(await storedEntry(USER_ACTION_ID)).toBeUndefined()
  })

  // A regenerate sweeps by log position from the reply's create, not by action group.
  it("removes the turn's new rows on a regenerate sweep from the reply", async () => {
    await seedTurn()
    const { events } = await foldTurn(CREATE_REPLY)
    await applyEvents(events)
    const created = createdEntities(events).map((e) => e.id)
    const replyId = replyOf(events).id

    const swept = await resolveSweep('b1', replyId, turnCtx())
    if ('status' in swept) throw new Error(`sweep refused: ${swept.reason}`)
    await reverseAndPruneDeltaRows(swept.set, turnCtx(), { keepRedoExact: false }, swept.clampOps)

    const rows = await branchRows()
    expect(rows.filter((r) => created.includes(r.id))).toEqual([])
    expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
      current_location_id: TOWN,
      inventory: [],
    })
    expect(await storedEntry(replyId)).toBeUndefined()
    expect(await storedEntry(USER_ACTION_ID)).toBeDefined()
  })

  // The fold failed, so the fallback is the only creator; its rows must leave with the turn.
  async function failedFoldThenFallbackCreates() {
    await seedTurn()
    const failing = CREATE_REPLY.replace(
      '<world_time_delta>60</world_time_delta>',
      '<world_time_delta>soon</world_time_delta>',
    )
    const fold = await foldTurn(failing)
    await applyEvents(fold.events)
    generateStructuredMock.mockResolvedValueOnce({
      status: 'ok',
      recoverable: [],
      value: fallbackClassifierSchema.parse({
        sceneEntities: ['c1'],
        newLocations: [
          {
            handle: 'new:docks',
            name: 'Smuggler Docks',
            description: 'a rotting pier',
            parent: 'l1',
          },
        ],
        currentLocation: 'new:docks',
        worldTimeDelta: 30,
        newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
        transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
      }),
    })
    const fallback = await drain(phaseAt(3)(phaseCtx(fold.intermediates)))
    await applyEvents(fallback.events)
    const created = createdEntities(fallback.events).map((e) => e.id)
    expect(created).toHaveLength(2)
    expect((await branchRows()).filter((r) => created.includes(r.id))).toHaveLength(2)
    return { created, replyId: replyOf(fold.events).id }
  }

  const HERO_BEFORE = { current_location_id: TOWN, inventory: [] }

  it("removes the fallback's new rows when the turn is undone", async () => {
    const { created } = await failedFoldThenFallbackCreates()

    expect(await undoLastAction('b1', turnCtx())).toEqual({ status: 'ok' })

    const rows = await branchRows()
    expect(rows.filter((r) => created.includes(r.id))).toEqual([])
    expect(rows.find((r) => r.id === HERO)?.state).toMatchObject(HERO_BEFORE)
  })

  it("removes the fallback's new rows on a regenerate sweep from the reply", async () => {
    const { created, replyId } = await failedFoldThenFallbackCreates()

    const swept = await resolveSweep('b1', replyId, turnCtx())
    if ('status' in swept) throw new Error(`sweep refused: ${swept.reason}`)
    await reverseAndPruneDeltaRows(swept.set, turnCtx(), { keepRedoExact: false }, swept.clampOps)

    const rows = await branchRows()
    expect(rows.filter((r) => created.includes(r.id))).toEqual([])
    expect(rows.find((r) => r.id === HERO)?.state).toMatchObject(HERO_BEFORE)
    expect(await storedEntry(replyId)).toBeUndefined()
    expect(await storedEntry(USER_ACTION_ID)).toBeDefined()
  })

  // piggyback.md → Parse strategy and failure recovery: stackables add, so a failed fold holds them
  // back for the fallback, which would otherwise move the same amount twice.
  describe('a failed fold with a stackable', () => {
    const goldReply =
      'Aria pockets the purse.\n<state><scene_entities>c1</scene_entities>' +
      '<transfers><stackable key="gold" amount="10" to="c1" /></transfers>' +
      '<world_time_delta>soon</world_time_delta></state>'

    it('moves the gold once, through the fallback', async () => {
      await seedTurn([
        worldRow({
          id: HERO,
          kind: 'character',
          name: 'Aria',
          state: { ...emptyEntityState('character'), current_location_id: TOWN },
        }),
        worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
      ])
      const log = spyLogger()
      const fold = await foldTurn(goldReply, { log })
      expect(fold.intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
      expect(
        fold.events.filter(
          (e) => e.type === 'delta_emitted' && e.action.kind === 'updateEntityStackables',
        ),
      ).toEqual([])
      expect(log.debug).toHaveBeenCalledWith('classifier.stackables_held', {
        entryId: replyOf(fold.events).id,
        keys: ['gold'],
      })
      await applyEvents(fold.events)

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        recoverable: [],
        value: fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          worldTimeDelta: 30,
          transfers: { items: [], stackables: [{ key: 'gold', amount: 10, to: 'c1' }], drops: [] },
        }),
      })
      const fallback = await drain(phaseAt(3)(phaseCtx(fold.intermediates)))
      await applyEvents(fallback.events)
      const hero = (await branchRows()).find((r) => r.id === HERO)
      expect(hero?.state).toMatchObject({ stackables: { gold: 10 } })
    })
  })

  // piggyback.md → Parse strategy and failure recovery: a failed fold that can't use its own place
  // holds its drops back, so the item is still held when the fallback puts it down there.
  describe('a fold with a drop', () => {
    const SWORD = 'item_00000000-0000-4000-8000-0000000000b2'
    const swordWorld = (): Entity[] => [
      worldRow({
        id: HERO,
        kind: 'character',
        name: 'Aria',
        state: { ...emptyEntityState('character'), current_location_id: TOWN, inventory: [SWORD] },
      }),
      worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
      worldRow({ id: SWORD, kind: 'item', name: 'worn sword', state: { at_location_id: null } }),
    ]
    // c1 HERO, l1 TOWN; the sword, the one item, is i1. A delta of `soon` fails the parse.
    const dropReply = (delta: string) =>
      'Aria walks down to the docks and sets her sword on a crate.\n<state><scene_entities>c1</scene_entities>' +
      '<new_location handle="new:docks" parent="l1" name="Smuggler Docks">a rotting pier</new_location>' +
      '<current_location>new:docks</current_location>' +
      '<transfers><drop id="i1" from="c1" /></transfers>' +
      `<world_time_delta>${delta}</world_time_delta></state>`

    it('a parsed fold puts the item down at the place it creates', async () => {
      await seedTurn(swordWorld())
      const log = spyLogger()
      const { events, intermediates } = await foldTurn(dropReply('30'), { log })
      expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: true })
      await applyEvents(events)
      const [docks] = createdEntities(events)
      if (!docks) throw new Error('expected the docks create')
      const rows = await branchRows()
      expect(rows.find((r) => r.id === SWORD)?.state).toEqual({ at_location_id: docks.id })
      expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
        current_location_id: docks.id,
        equipped_items: [],
        inventory: [],
      })
      expect(replyOf(events).metadata?.stateReport?.transfers?.drops).toEqual([
        { id: SWORD, from: HERO, at: docks.id },
      ])
      expect(log.debug).not.toHaveBeenCalledWith('classifier.drops_held', expect.anything())
    })

    async function failedFold(reply = dropReply('soon')) {
      await seedTurn(swordWorld())
      const log = spyLogger()
      const fold = await foldTurn(reply, { log })
      expect(fold.intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
      await applyEvents(fold.events)
      return { ...fold, log, replyId: replyOf(fold.events).id }
    }

    async function fallbackReplies(
      fold: { intermediates: Record<string, unknown> },
      reply: Awaited<ReturnType<typeof generateStructuredMock>>,
    ) {
      generateStructuredMock.mockResolvedValueOnce(reply)
      const fallback = await drain(phaseAt(3)(phaseCtx(fold.intermediates)))
      await applyEvents(fallback.events)
      return fallback.events
    }

    it('a failed fold leaves the item to the fallback, which puts it down where it moves', async () => {
      const fold = await failedFold()
      expect(
        fold.events.filter(
          (e) =>
            e.type === 'delta_emitted' &&
            (e.action.kind === 'updateItemPosition' || e.action.kind === 'updateEntityInventory'),
        ),
      ).toEqual([])
      expect(replyOf(fold.events).metadata?.stateReport?.transfers?.drops).toBeUndefined()
      expect(fold.log.debug).toHaveBeenCalledWith('classifier.drops_held', {
        entryId: fold.replyId,
        itemIds: [SWORD],
      })

      const events = await fallbackReplies(fold, {
        status: 'ok',
        recoverable: [],
        value: fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [
            {
              handle: 'new:docks',
              name: 'Smuggler Docks',
              description: 'a rotting pier',
              parent: 'l1',
            },
          ],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
          transfers: { items: [], stackables: [], drops: [{ id: 'i1', from: 'c1' }] },
        }),
      })
      const [docks] = createdEntities(events)
      if (!docks) throw new Error('expected the docks create')
      const rows = await branchRows()
      expect(rows.find((r) => r.id === SWORD)?.state).toEqual({ at_location_id: docks.id })
      expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
        current_location_id: docks.id,
        equipped_items: [],
        inventory: [],
      })
      expect((await storedEntry(fold.replyId))?.metadata?.stateReport?.transfers?.drops).toEqual([
        { id: SWORD, from: HERO, at: docks.id },
      ])
    })

    // Accepted, as for its creates: nothing else puts the item down.
    it.each([
      [
        'a fallback reply without the drop',
        {
          status: 'ok' as const,
          value: fallbackClassifierSchema.parse({ sceneEntities: ['c1'], worldTimeDelta: 30 }),
          recoverable: [],
        },
      ],
      [
        'a failed fallback call',
        {
          status: 'failed' as const,
          error: { tier: 'provider' as const, reason: 'unknown' as const, detail: 'LLM error' },
          recoverable: [],
        },
      ],
    ])(
      'a failed fold leaves the item held after %s, with no drop on the record',
      async (_label, reply) => {
        const fold = await failedFold()
        await fallbackReplies(fold, reply)
        const rows = await branchRows()
        expect(rows.find((r) => r.id === SWORD)?.state).toEqual({ at_location_id: null })
        expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({ inventory: [SWORD] })
        const final = (await storedEntry(fold.replyId))?.metadata?.stateReport
        expect(final?.failedFields?.map((f) => f.field)).toContain('worldTimeDelta')
        expect(final?.transfers?.drops).toBeUndefined()
      },
    )

    const docksFallback = {
      status: 'ok' as const,
      recoverable: [],
      value: fallbackClassifierSchema.parse({
        sceneEntities: ['c1'],
        newLocations: [
          {
            handle: 'new:docks',
            name: 'Smuggler Docks',
            description: 'a rotting pier',
            parent: 'l1',
          },
        ],
        currentLocation: 'new:docks',
        worldTimeDelta: 30,
        transfers: { items: [], stackables: [], drops: [{ id: 'i1', from: 'c1' }] },
      }),
    }

    it('a failed fold whose location field failed leaves the item to the fallback', async () => {
      const fold = await failedFold(
        'Aria walks on and sets her sword on a crate.\n<state><scene_entities>c1</scene_entities>' +
          '<current_location>l9</current_location>' +
          '<transfers><drop id="i1" from="c1" /></transfers>' +
          '<world_time_delta>30</world_time_delta></state>',
      )
      expect(replyOf(fold.events).metadata?.stateReport?.failedFields?.map((f) => f.field)).toEqual(
        ['currentLocation'],
      )
      expect(replyOf(fold.events).metadata?.stateReport?.transfers?.drops).toBeUndefined()
      expect(fold.log.debug).toHaveBeenCalledWith('classifier.drops_held', {
        entryId: fold.replyId,
        itemIds: [SWORD],
      })
      const events = await fallbackReplies(fold, docksFallback)
      const [docks] = createdEntities(events)
      if (!docks) throw new Error('expected the docks create')
      expect((await branchRows()).find((r) => r.id === SWORD)?.state).toEqual({
        at_location_id: docks.id,
      })
    })

    // piggyback.md → Trailing block format: a drop away from the scene stays prose.
    it.each([
      ['a listed place', 'l2'],
      ['nothing', 'l99'],
    ])('leaves the item held when its drop names %s', async (_label, to) => {
      await seedTurn(swordWorld())
      const log = spyLogger()
      const { events, intermediates } = await foldTurn(
        'Aria throws her sword into the market well.\n<state><scene_entities>c1</scene_entities>' +
          `<transfers><drop id="i1" from="c1" to="${to}" /></transfers>` +
          '<world_time_delta>30</world_time_delta></state>',
        { log },
      )
      expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: true })
      await applyEvents(events)
      const rows = await branchRows()
      expect(rows.find((r) => r.id === SWORD)?.state).toEqual({ at_location_id: null })
      expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({ inventory: [SWORD] })
      expect(replyOf(events).metadata?.stateReport?.transfers).toEqual({
        items: [],
        stackables: [],
      })
      expect(log.warn).toHaveBeenCalledWith('classifier.drop_dropped', {
        entryId: replyOf(events).id,
        drop: { id: 'i1', to },
        reason: 'to_named',
      })
    })

    // A new item's drop stays prose as on any skipped create; only a real item is held back.
    it('a failed fold holds back only the drops that name a real item', async () => {
      const fold = await failedFold(
        dropReply('soon').replace(
          '<transfers><drop id="i1" from="c1" /></transfers>',
          '<new_item handle="new:rope" name="coil of rope">tarred hemp</new_item>' +
            '<transfers><drop id="new:rope" /><drop id="i1" from="c1" /></transfers>',
        ),
      )
      expect(fold.log.debug).toHaveBeenCalledWith('classifier.drop_dropped', {
        handle: 'new:rope',
        reason: 'not-created',
      })
      expect(fold.log.debug).toHaveBeenCalledWith('classifier.drops_held', {
        entryId: fold.replyId,
        itemIds: [SWORD],
      })
    })

    // piggyback.md → Parse strategy: a cut may have taken the place the scene moved to.
    it('holds the drops of a block the stream cut off before any place, logged as cut off', async () => {
      const fold = await failedFold(
        'Aria sets her sword on a crate.\n<state><scene_entities>c1</scene_entities>' +
          '<transfers><drop id="i1" from="c1" /></transfers><world_time_delta>30',
      )
      expect(fold.log.debug).toHaveBeenCalledWith('classifier.drops_held', {
        entryId: fold.replyId,
        itemIds: [SWORD],
        reason: 'cut_off',
      })
      expect(replyOf(fold.events).metadata?.stateReport?.transfers?.drops).toBeUndefined()
    })

    // The fold can use its own place, or keeps the previous one for a place apply.ts rejects on any
    // block: the drop lands now.
    describe('a failed fold whose place stands', () => {
      const sceneReply = (location: string, transfers: string) =>
        'Aria sets her sword on a crate.\n<state><scene_entities>c1</scene_entities>' +
        location +
        `<transfers>${transfers}</transfers><world_time_delta>soon</world_time_delta></state>`

      it.each([
        ['names no location', ''],
        ['names the scene place', '<current_location>l1</current_location>'],
        ['names an item, which apply.ts rejects', '<current_location>i1</current_location>'],
      ])('puts the item down at the scene when it %s', async (_label, location) => {
        const fold = await failedFold(sceneReply(location, '<drop id="i1" from="c1" />'))
        const rows = await branchRows()
        expect(rows.find((r) => r.id === SWORD)?.state).toEqual({ at_location_id: TOWN })
        expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
          equipped_items: [],
          inventory: [],
        })
        expect(replyOf(fold.events).metadata?.stateReport?.transfers?.drops).toEqual([
          { id: SWORD, from: HERO, at: TOWN },
        ])
        expect(fold.log.debug).not.toHaveBeenCalledWith('classifier.drops_held', expect.anything())
      })

      it('applies a take and then a drop, so the item lies at the scene', async () => {
        await failedFold(
          sceneReply(
            '',
            '<item id="i1" to="c1" slot="equipped_items" /><drop id="i1" from="c1" />',
          ),
        )
        const rows = await branchRows()
        expect(rows.find((r) => r.id === SWORD)?.state).toEqual({ at_location_id: TOWN })
        expect(rows.find((r) => r.id === HERO)?.state).toMatchObject({
          equipped_items: [],
          inventory: [],
        })
      })
    })
  })

  const MALFORMED =
    '<new_item handle="key" name="key">a key</new_item>' +
    '<new_location handle="new:" name="Nowhere">nothing</new_location>'

  const MALFORMED_ITEM = '<new_item handle="key" name="key">a key</new_item>'

  it('warns about malformed creates without failing the parse', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    await seedTurn()
    const { events, intermediates } = await foldTurn(
      'Aria pockets something.\n<state><scene_entities>c1</scene_entities>' +
        `${MALFORMED}<world_time_delta>5</world_time_delta></state>`,
      { log: logger },
    )
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: true })
    expect(createdEntities(events)).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_malformed', {
      entryId: replyOf(events).id,
      count: 2,
      layer: 'piggyback_tagged_block',
    })
  })

  it('warns about malformed creates when the parse fails too', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    await seedTurn()
    const { events, intermediates } = await foldTurn(
      'Aria pockets something.\n<state><scene_entities>c1</scene_entities>' +
        `${MALFORMED_ITEM}<world_time_delta>soon</world_time_delta></state>`,
      { log: logger },
    )
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: false })
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_malformed', {
      entryId: replyOf(events).id,
      count: 1,
      layer: 'piggyback_tagged_block',
    })
  })

  it("logs dropped creates through the phase's logger, so the entries carry the action", async () => {
    await seedTurn()
    const log = spyLogger()
    await foldTurn(
      'Aria glances at the sea.\n<state><scene_entities>c1</scene_entities>' +
        '<new_location handle="new:cove" parent="l1" name="Hidden Cove">a quiet inlet</new_location>' +
        '<new_location handle="new:pier" parent="nowhere" name="Old Pier">rotten planks</new_location>' +
        '<current_location>new:pier</current_location><world_time_delta>5</world_time_delta></state>',
      { log },
    )
    expect(log.debug).toHaveBeenCalledWith(
      'classifier.create_dropped',
      expect.objectContaining({ handle: 'new:cove' }),
    )
    expect(log.warn).toHaveBeenCalledWith(
      'classifier.create_parent_dropped',
      expect.objectContaining({ handle: 'new:pier', cause: 'unresolved' }),
    )
  })

  it('discards the reply when a cancel lands during the item match', async () => {
    await seedTurn([
      ...baseWorld(),
      worldRow({ id: OLD_KEY, kind: 'item', name: 'rusted key', description: 'an iron key' }),
    ])
    const controller = new AbortController()
    configureClassifierEmbedder(async (texts) => {
      controller.abort()
      return { vectors: texts.map(() => new Float32Array([1, 0])), dim: 2 }
    })
    const { events, result } = await foldTurn(CREATE_REPLY, { signal: controller.signal })
    expect(result).toEqual({ status: 'aborted' })
    expect(events.filter((e) => e.type === 'delta_emitted')).toEqual([])
  })

  // A cancel during an item's match embed must end it rather than wait out a slow provider.
  it("hands the run's signal to the item match embed, so a cancel ends it", async () => {
    await seedTurn([
      ...baseWorld(),
      worldRow({ id: OLD_KEY, kind: 'item', name: 'rusted key', description: 'an iron key' }),
    ])
    const controller = new AbortController()
    const embedSignals: (AbortSignal | undefined)[] = []
    configureClassifierEmbedder(async (texts, signal) => {
      embedSignals.push(signal)
      return { vectors: texts.map(() => new Float32Array([1, 0])), dim: 2 }
    })
    await foldTurn(CREATE_REPLY, { signal: controller.signal })
    expect(embedSignals).toHaveLength(1)
    expect(embedSignals[0]).toBe(controller.signal)
  })

  // data-model.md → Authorship contract, seen before written: the market is listed by name only.
  it('writes a condition only for a row its prompt showed with its state', async () => {
    const SWORD = 'item_00000000-0000-4000-8000-0000000000b2'
    await seedTurn([
      worldRow({
        id: HERO,
        kind: 'character',
        name: 'Aria',
        state: {
          ...emptyEntityState('character'),
          current_location_id: TOWN,
          equipped_items: [SWORD],
        },
      }),
      worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
      worldRow({
        id: MARKET,
        kind: 'location',
        name: 'The Drowned Market',
        state: { parent_location_id: TOWN },
      }),
      worldRow({ id: SWORD, kind: 'item', name: 'worn sword', state: { at_location_id: null } }),
    ])
    const log = spyLogger()
    // c1 HERO, l1 TOWN and l2 MARKET (foldTurn allocates them); the sword, the one item, is i1.
    const { events } = await foldTurn(
      'Aria nicks the blade on the rail.\n<state><world_time_delta>5</world_time_delta>' +
        '<conditions><entity id="i1">notched near the tip</entity>' +
        '<entity id="l2">half under water</entity></conditions></state>',
      { log },
    )
    await applyEvents(events)
    const rows = await branchRows()
    expect(rows.find((r) => r.id === SWORD)?.state).toEqual({
      at_location_id: null,
      condition: 'notched near the tip',
    })
    expect(rows.find((r) => r.id === MARKET)?.state).toEqual({ parent_location_id: TOWN })
    expect(log.warn).toHaveBeenCalledWith('classifier.condition_unseen', {
      entryId: expect.any(String),
      source: 'piggyback_tagged_block',
      entityId: MARKET,
      kind: 'location',
      shown: false,
    })
    expect(replyOf(events).metadata?.stateReport?.conditions).toEqual([
      { id: SWORD, text: 'notched near the tip' },
      { id: MARKET, text: 'half under water', rejected: true },
    ])
  })

  // data-model.md → Entry metadata shape: a blank condition is refused, World keeping the old one.
  describe('a blank condition', () => {
    const SWORD = 'item_00000000-0000-4000-8000-0000000000b2'
    const swordWorld = () => [
      worldRow({
        id: HERO,
        kind: 'character',
        name: 'Aria',
        state: {
          ...emptyEntityState('character'),
          current_location_id: TOWN,
          equipped_items: [SWORD],
        },
      }),
      worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
      worldRow({
        id: SWORD,
        kind: 'item',
        name: 'worn sword',
        state: { at_location_id: null, condition: 'notched near the tip' },
      }),
    ]
    // c1 HERO, l1 TOWN; the sword, the one item, is i1.
    const blankReply = (siblings: string) =>
      'Aria wipes the blade.\n<state><world_time_delta>5</world_time_delta>' +
      `<conditions><entity id="i1"></entity>${siblings}</conditions></state>`

    it('is reported refused alone, failing no field and leaving the row as it was', async () => {
      await seedTurn(swordWorld())
      const { events, intermediates } = await foldTurn(blankReply(''))
      expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: true })
      await applyEvents(events)
      const rows = await branchRows()
      expect(rows.find((r) => r.id === SWORD)?.state).toEqual({
        at_location_id: null,
        condition: 'notched near the tip',
      })
      const report = replyOf(events).metadata?.stateReport
      expect(report?.failedFields).toBeUndefined()
      expect(report?.conditions).toEqual([{ id: SWORD, text: '', rejected: true }])
    })

    // The sword is the one row this prompt shows with its state, so the sibling names it too.
    it('is reported refused beside a condition that lands', async () => {
      await seedTurn(swordWorld())
      const { events } = await foldTurn(blankReply('<entity id="i1">snapped at the hilt</entity>'))
      await applyEvents(events)
      const rows = await branchRows()
      expect(rows.find((r) => r.id === SWORD)?.state).toEqual({
        at_location_id: null,
        condition: 'snapped at the hilt',
      })
      expect(replyOf(events).metadata?.stateReport?.conditions).toEqual([
        { id: SWORD, text: '', rejected: true },
        { id: SWORD, text: 'snapped at the hilt' },
      ])
    })
  })
})

// architecture.md → System and user halves. Fixture fills Setting/Genre/Tone and the calendar
// always resolves, so all four lead the system half.
describe('narrative fold — prompt halves', () => {
  it('sends the definition and calendar as the system half, and the scene and story as the user half', async () => {
    const { system, prompt: user } = await runNarrativeWith({ narrative: 'prose' })
    expect(system).toMatch(
      /^# Setting\nA keep on a hill\.\n\n# Genre\nHigh fantasy\.\n\n# Tone\nDry humor\.\n\n# Calendar\nThis story tracks time in /,
    )
    expect(system).toMatch(
      /[^\n]\n\nWrite the next beat of the story as prose\. Do not break character or address the reader\.$/,
    )
    expect(user).toContain('# Story so far')
    expect(user).not.toContain('# Setting')
    expect(user).not.toContain('# Calendar')
  })
})

// generation-pipeline.md → Cut-off replies.
describe('narrative — how the reply ended', () => {
  const PROSE = 'The lantern guttered as Kael reached for the'
  const BLOCK = '<state><world_time_delta>30</world_time_delta></state>'

  // A finish reason that can't be read: the SDK rejects it when no step was recorded. Rejects only
  // once read: an eager Promise.reject would be reported unhandled before the phase reaches it.
  const unreadable = {
    then: (_settle: unknown, fail: (error: unknown) => void) => fail(new Error('no finish part')),
  }

  const cutWarning = (fields: Record<string, unknown>) => ({
    reasoningTokens: null,
    window: null,
    providerId: 'prov-1',
    modelId: 'model-1',
    target: 'narrative',
    entryId: expect.any(String),
    ...fields,
  })

  async function runReply(opts: {
    text: string
    finishReason?: unknown
    usage?: unknown
    maxOutput?: number
    window?: GenerationWindow
    promptEstimate?: number
    piggyback?: boolean
    log?: ReturnType<typeof spyLogger>
  }) {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({
        partialChapterBuffer: 3,
        piggybackMode: opts.piggyback ? 'on' : 'off',
      }),
    })
    hydrateEntries(phaseDb, 'b1', [])
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
    // The facade has an estimate only once the SDK built the request, after the stream began.
    let estimate: number | null = null
    streamTextMock.mockReturnValue(
      streamCall({
        maxOutput: opts.maxOutput,
        ...(opts.window !== undefined ? { window: opts.window } : {}),
        promptEstimate: () => estimate,
        stream: {
          fullStream: (async function* () {
            if (opts.text !== '') yield { type: 'text-delta', text: opts.text }
            estimate = opts.promptEstimate ?? null
          })(),
          finishReason: opts.finishReason,
          usage: opts.usage,
        },
      }),
    )

    const log = opts.log ?? spyLogger()
    const intermediates: Record<string, unknown> = {}
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')
    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates,
      log,
      runInTransaction: async () => undefined,
      db: phaseDb.db,
      storyId: 's1',
      branchId: 'b1',
    })
    const events: PhaseEmittedEvent[] = []
    let next = await gen.next()
    while (!next.done) {
      events.push(next.value)
      next = await gen.next()
    }
    const created = events.find(
      (e) => e.type === 'delta_emitted' && e.action.kind === 'createStoryEntry',
    )
    const entry =
      created?.type === 'delta_emitted' && created.action.kind === 'createStoryEntry'
        ? created.action.payload.entry
        : undefined
    return { result: next.value, events, entry, intermediates, log }
  }

  it.each([
    [
      'no max output, no usage',
      {},
      { cause: 'unknown' },
      { cause: 'unknown', outputTokens: null, maxOutput: null },
    ],
    [
      'a max output it reached',
      { maxOutput: 512, usage: { outputTokens: 512 } },
      { cause: 'max-output', outputTokens: 512, limit: 512 },
      { cause: 'max-output', outputTokens: 512, maxOutput: 512 },
    ],
    [
      'a max output and no count',
      { maxOutput: 512 },
      { cause: 'max-output', limit: 512 },
      { cause: 'max-output', outputTokens: null, maxOutput: 512 },
    ],
    [
      'a max output it fell short of',
      { maxOutput: 512, usage: { outputTokens: 300 } },
      { cause: 'unknown', outputTokens: 300, maxOutput: 512 },
      { cause: 'unknown', outputTokens: 300, maxOutput: 512 },
    ],
  ])('marks a reply cut in its prose (%s)', async (_label, call, mark, warned) => {
    const { result, entry, log } = await runReply({ text: PROSE, finishReason: 'length', ...call })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.content).toBe(PROSE)
    expect(entry?.metadata?.cutOff).toStrictEqual(mark)
    expect(log.warn).toHaveBeenCalledWith(
      'provider.reply_cut_off',
      cutWarning({ ...warned, entryId: entry?.id, outcome: 'marked' }),
    )
  })

  // The estimate is read after the stream: an earlier read gets null and the cause `unknown`.
  it('marks a cut as window when the estimate and the output reach a known window', async () => {
    const { result, entry, log } = await runReply({
      text: PROSE,
      finishReason: 'length',
      usage: { outputTokens: 100 },
      window: { tokens: 1000, source: 'configured' },
      promptEstimate: 900,
    })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.metadata?.cutOff).toStrictEqual({
      cause: 'window',
      outputTokens: 100,
      limit: 1000,
    })
    expect(log.warn).toHaveBeenCalledWith(
      'provider.reply_cut_off',
      cutWarning({
        cause: 'window',
        outputTokens: 100,
        maxOutput: null,
        window: 1000,
        entryId: entry?.id,
        outcome: 'marked',
      }),
    )
  })

  // piggyback.md → Parse strategy: a cut block holding no create or drop parses clean.
  it('marks nothing when the cut falls in the trailing block, which reads as before', async () => {
    const { result, entry, intermediates, log } = await runReply({
      text: 'The knight drew his sword.\n<state><world_time_delta>30</world_time_delta>',
      finishReason: 'length',
      piggyback: true,
    })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.content).toBe('The knight drew his sword.')
    expect(entry?.metadata).not.toHaveProperty('cutOff')
    expect(entry?.metadata?.stateReport).toMatchObject({
      layer: 'piggyback_tagged_block',
      worldTimeDelta: 30,
    })
    expect(entry?.metadata?.stateReport?.failedFields).toBeUndefined()
    expect(intermediates.piggybackOutcome).toEqual({ attempted: true, succeeded: true })
    expect(log.warn).toHaveBeenCalledWith(
      'provider.reply_cut_off',
      cutWarning({
        cause: 'unknown',
        outputTokens: null,
        maxOutput: null,
        entryId: entry?.id,
        outcome: 'in-block',
      }),
    )
  })

  // Uncut, the fragment would sit after the closed block and read as prose out of position.
  it('drops a root opener the cut fell inside, before anything parses the reply', async () => {
    const { result, entry, log } = await runReply({
      text: `The knight drew his sword.\n${BLOCK}\n<sugg`,
      finishReason: 'length',
      piggyback: true,
    })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.content).toBe('The knight drew his sword.')
    expect(entry?.metadata).not.toHaveProperty('cutOff')
    expect(log.warn).not.toHaveBeenCalledWith(
      'classifier.state_block_out_of_position',
      expect.anything(),
    )
    expect(log.warn).toHaveBeenCalledWith(
      'provider.reply_cut_off',
      cutWarning({
        cause: 'unknown',
        outputTokens: null,
        maxOutput: null,
        entryId: entry?.id,
        outcome: 'in-block',
      }),
    )
  })

  // A cut reply that is only a block fails too, or the entry would be markup.
  it.each([
    ['no text', ''],
    ['only whitespace', '\n\n'],
    ['only a trailing block', BLOCK],
    ['only a root opener cut mid-name', '<sta'],
  ])('fails a cut reply with %s as reply-cut-off, committing nothing', async (_label, text) => {
    const { result, events, log } = await runReply({
      text,
      finishReason: 'length',
      maxOutput: 512,
      usage: { outputTokens: 512, outputTokenDetails: { reasoningTokens: 200 } },
      piggyback: true,
    })

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'reply-cut-off',
        target: 'narrative',
        cause: 'max-output',
        outputTokens: 512,
        reasoningTokens: 200,
        maxOutput: 512,
        window: null,
        providerId: 'prov-1',
        modelId: 'model-1',
      },
    })
    expect(events.filter((e) => e.type === 'delta_emitted')).toEqual([])
    expect(log.warn).toHaveBeenCalledWith(
      'provider.reply_cut_off',
      cutWarning({
        cause: 'max-output',
        outputTokens: 512,
        reasoningTokens: 200,
        maxOutput: 512,
        outcome: 'failed',
      }),
    )
  })

  // Any finish but 'length', or none, is finished; no blank ai_reply commits.
  it.each([
    ['stop', '', 'stop', 'stop'],
    ['stop, as whitespace', ' \n', 'stop', 'stop'],
    ['content-filter', '', 'content-filter', 'content-filter'],
    ['other', '', 'other', 'other'],
    ['error', '', 'error', 'error'],
    ['tool-calls', '', 'tool-calls', 'tool-calls'],
    ['no finish reason', '', undefined, 'none'],
    ['an unreadable finish reason', '', unreadable, 'none'],
  ])(
    'fails a blank reply that finished with %s as an empty reply',
    async (_label, text, finishReason, named) => {
      const { result, events, log } = await runReply({ text, finishReason })

      expect(result).toEqual({
        status: 'failed',
        error: {
          kind: 'phase-logic',
          subsystem: 'empty-reply',
          detail: `the model returned no text (finish reason: ${named})`,
        },
      })
      expect(events.filter((e) => e.type === 'delta_emitted')).toEqual([])
      expect(log.warn).not.toHaveBeenCalledWith('provider.reply_cut_off', expect.anything())
    },
  )

  it('keeps the raw text of a finished reply that is only a trailing block', async () => {
    const { result, entry } = await runReply({ text: BLOCK, finishReason: 'stop', piggyback: true })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.content).toBe(BLOCK)
  })

  // The output reached the max output, so only the finish reason can tell these apart from a cut.
  it.each([
    ['stop', 'stop'],
    ['content-filter', 'content-filter'],
    ['an unreadable finish reason', unreadable],
  ])('commits a reply with text that finished with %s, unmarked', async (_label, finishReason) => {
    const { result, entry, log } = await runReply({
      text: PROSE,
      finishReason,
      maxOutput: 512,
      usage: { outputTokens: 512 },
    })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.content).toBe(PROSE)
    expect(entry?.metadata).not.toHaveProperty('cutOff')
    expect(log.warn).not.toHaveBeenCalledWith('provider.reply_cut_off', expect.anything())
  })

  it('commits a finished reply ending in a root opener prefix as written', async () => {
    const text = `${PROSE}\n<s`
    const { result, entry } = await runReply({ text, finishReason: 'stop' })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.content).toBe(text)
  })

  it('commits no newline the removed opener stood behind', async () => {
    const { result, entry } = await runReply({
      text: 'The knight drew his sword.\n<sta',
      finishReason: 'length',
      piggyback: true,
    })

    expect(result).toEqual({ status: 'completed' })
    expect(entry?.content).toBe('The knight drew his sword.')
  })

  it('logs a cut in the prose even when the fold after it throws', async () => {
    const entryReads = await import('./entry-reads')
    vi.spyOn(entryReads, 'readStoryPlace').mockRejectedValue(new Error('place read failed'))
    const log = spyLogger()

    await expect(
      runReply({
        text: `The knight drew his sword.\n${BLOCK}\n${PROSE}`,
        finishReason: 'length',
        piggyback: true,
        log,
      }),
    ).rejects.toThrow('place read failed')
    expect(log.warn).toHaveBeenCalledWith(
      'provider.reply_cut_off',
      cutWarning({ cause: 'unknown', outputTokens: null, maxOutput: null, outcome: 'marked' }),
    )
  })

  it.each([
    ['max output', { cause: 'max-output' as const }],
    ['window', { cause: 'window' as const }],
  ])('marks a %s cut whose limit is missing as unknown', async (_label, failure) => {
    const ai = await import('@/lib/ai')
    vi.spyOn(ai, 'replyCutOff').mockReturnValue({
      ...failure,
      outputTokens: null,
      reasoningTokens: null,
      maxOutput: null,
      window: null,
      providerId: 'prov-1',
      modelId: 'model-1',
    })
    const { entry } = await runReply({ text: PROSE, finishReason: 'length' })

    expect(entry?.metadata?.cutOff).toStrictEqual({ cause: 'unknown' })
  })

  it('keeps the max output a cut fell short of when its window is missing', async () => {
    const ai = await import('@/lib/ai')
    vi.spyOn(ai, 'replyCutOff').mockReturnValue({
      cause: 'window',
      outputTokens: 300,
      reasoningTokens: null,
      maxOutput: 512,
      window: null,
      providerId: 'prov-1',
      modelId: 'model-1',
    })
    const { entry } = await runReply({ text: PROSE, finishReason: 'length' })

    expect(entry?.metadata?.cutOff).toStrictEqual({
      cause: 'unknown',
      outputTokens: 300,
      maxOutput: 512,
    })
  })
})

// architecture.md → The pre-send check; generation-pipeline.md → Fatal error categories.
describe('narrative — a stream error', () => {
  const LLAMA_MESSAGE =
    'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'
  const CHECK_FAILURE: ContextWindowFailure = {
    detectedBy: 'check',
    estimate: 71_234,
    window: 65_536,
    windowSource: 'configured',
    providerId: 'prov-1',
    modelId: 'model-1',
  }
  const PROVIDER_FAILURE: ContextWindowFailure = {
    detectedBy: 'provider',
    estimate: 71_234,
    window: null,
    windowSource: 'unknown',
    providerId: 'prov-1',
    modelId: 'model-1',
    detail: LLAMA_MESSAGE,
  }

  function rejection(statusCode: number, message: string): APICallError {
    return new APICallError({
      message,
      url: 'http://127.0.0.1:9/v1/chat/completions',
      requestBodyValues: {},
      statusCode,
      responseBody: JSON.stringify({ error: { message, type: 'invalid_request_error' } }),
    })
  }

  // contextWindowFailureOf and capabilityHintOf are faked: they answer `windowFailure` and `hint`
  // for this stream's error only.
  async function runStreamError(
    error: unknown,
    windowFailure: ContextWindowFailure | null = null,
    hint?: CapabilityHint,
  ) {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings: baseSettings({ partialChapterBuffer: 3 }),
    })
    hydrateEntries(phaseDb, 'b1', [])
    entitiesStore.hydrate('b1', [])
    const contextWindowFailureOf = vi.fn((streamError: unknown) =>
      streamError === error ? windowFailure : null,
    )
    const capabilityHintOf = vi.fn((streamError: unknown) =>
      streamError === error ? hint : undefined,
    )
    streamTextMock.mockImplementation((_target, opts) =>
      streamCall({
        contextWindowFailureOf,
        capabilityHintOf,
        stream: {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'The lantern gutt' }
            opts.onError?.({ error })
          })(),
        },
      }),
    )
    const log = spyLogger()
    ensurePerTurnPipelineRegistered()
    const phase = getPipeline(PER_TURN_KIND).phases[2]
    if (!phase || !('run' in phase)) throw new Error('expected narrative phase')
    const gen = phase.run({
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates: {},
      log,
      runInTransaction: async () => undefined,
      db: phaseDb.db,
      storyId: 's1',
      branchId: 'b1',
    })
    const events: PhaseEmittedEvent[] = []
    let next = await gen.next()
    while (!next.done) {
      events.push(next.value)
      next = await gen.next()
    }
    return { result: next.value, events, log, contextWindowFailureOf, capabilityHintOf }
  }

  it.each([
    ["the window check's refusal", () => new ContextWindowError(CHECK_FAILURE), CHECK_FAILURE],
    ['a recognized overflow rejection', () => rejection(400, LLAMA_MESSAGE), PROVIDER_FAILURE],
  ])('fails %s as context-window, not as a stream failure', async (_label, makeError, failure) => {
    const error = makeError()

    const { result, events, log, contextWindowFailureOf } = await runStreamError(error, failure)

    expect(contextWindowFailureOf).toHaveBeenCalledWith(error)
    expect(result).toStrictEqual({
      status: 'failed',
      error: { kind: 'context-window', target: 'narrative', ...failure },
    })
    expect(events.filter((e) => e.type === 'delta_emitted')).toEqual([])
    expect(log.warn).toHaveBeenCalledWith('provider.context_window', {
      target: 'narrative',
      ...failure,
    })
    expect(log.error).not.toHaveBeenCalledWith(
      'provider.narrative_stream_failed',
      expect.anything(),
    )
  })

  // lib/ai matches the hint, against what this call's request carried.
  it("carries the call's capability hint for its stream error", async () => {
    const error = rejection(400, 'thinking is not supported for this model')
    const hint: CapabilityHint = { capability: 'reasoning', matched: 'thinking' }

    const { result, log, capabilityHintOf } = await runStreamError(error, null, hint)

    expect(capabilityHintOf).toHaveBeenCalledWith(error)
    expect(result).toStrictEqual({
      status: 'failed',
      error: {
        kind: 'provider',
        reason: 'network',
        detail: 'APICallError: thinking is not supported for this model',
        possibleCapabilityMismatch: { capability: 'reasoning', matched: 'thinking' },
      },
    })
    expect(log.error).toHaveBeenCalledWith(
      'provider.narrative_stream_failed',
      expect.objectContaining({ statusCode: 400 }),
    )
    expect(log.warn).not.toHaveBeenCalledWith('provider.context_window', expect.anything())
  })

  // toStrictEqual: a `possibleCapabilityMismatch: undefined` key fails it.
  it.each([
    ['a plain error', () => new Error('socket hang up'), 'socket hang up'],
    [
      'a 4xx naming a capability',
      () => rejection(400, 'thinking is not supported for this model'),
      'APICallError: thinking is not supported for this model',
    ],
  ])('omits the hint the call gives none for, on %s', async (_label, makeError, detail) => {
    const { result } = await runStreamError(makeError())

    expect(result).toStrictEqual({
      status: 'failed',
      error: { kind: 'provider', reason: 'network', detail },
    })
  })
})
