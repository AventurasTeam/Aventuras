import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { IdBiMap } from '@/lib/ids'
import { runPreflight } from '@/lib/pipeline/runtime/preflight'
import type { Pipeline, PreflightSnapshot } from '@/lib/pipeline/types'
import { currentStoryStore, entitiesStore, entriesStore, resetAllStores } from '@/lib/stores'

import {
  piggybackFallbackClassifierPhase,
  PIGGYBACK_FALLBACK_RESOLVES,
  resolvePiggybackFires,
  shouldFallbackFire,
  type PiggybackOutcome,
} from './per-turn-piggyback'

const definition = {
  mode: 'adventure' as const,
  leadEntityId: null,
  narration: 'first' as const,
  genre: { label: 'Fantasy', promptBody: '' },
  tone: { label: 'Wry', promptBody: '' },
  setting: '',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    generateStructured: generateStructuredMock,
  }
})

describe('per-turn-piggyback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    generateStructuredMock.mockReset()
    resetAllStores()
  })

  describe('resolvePiggybackFires', () => {
    it('returns false when piggybackMode is off', () => {
      expect(
        resolvePiggybackFires({
          piggybackMode: 'off',
          narrativeModelCapabilities: { taggedBlockReliable: true },
        }),
      ).toBe(false)
    })

    it('returns false when piggybackMode is on but capabilities are missing or unreliable', () => {
      expect(
        resolvePiggybackFires({
          piggybackMode: 'on',
          narrativeModelCapabilities: undefined,
        }),
      ).toBe(false)

      expect(
        resolvePiggybackFires({
          piggybackMode: 'on',
          narrativeModelCapabilities: { taggedBlockReliable: false },
        }),
      ).toBe(false)
    })

    it('returns true when piggybackMode is on and taggedBlockReliable is true', () => {
      expect(
        resolvePiggybackFires({
          piggybackMode: 'on',
          narrativeModelCapabilities: { taggedBlockReliable: true },
        }),
      ).toBe(true)
    })
  })

  describe('shouldFallbackFire', () => {
    it('returns true when outcome is undefined', () => {
      expect(shouldFallbackFire(undefined)).toBe(true)
    })

    it('returns true when outcome was not attempted', () => {
      expect(shouldFallbackFire({ attempted: false, succeeded: false })).toBe(true)
    })

    it('returns true when outcome was attempted but failed', () => {
      expect(shouldFallbackFire({ attempted: true, succeeded: false })).toBe(true)
    })

    it('returns false when outcome was attempted and succeeded', () => {
      expect(shouldFallbackFire({ attempted: true, succeeded: true })).toBe(false)
    })
  })

  describe('piggybackFallbackClassifierPhase', () => {
    it('returns failed status if no story is open', async () => {
      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const res = await gen.next()

      expect(res).toEqual({
        done: true,
        value: {
          status: 'failed',
          error: { kind: 'orchestrator', detail: 'piggyback-fallback: no open story' },
        },
      })
    })

    it('completes early without calling generateStructured if fallback should not fire', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { piggybackMode: 'on' } as never,
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: {
          piggybackOutcome: { attempted: true, succeeded: true } satisfies PiggybackOutcome,
        },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const res = await gen.next()

      expect(res).toEqual({ done: true, value: { status: 'completed' } })
      expect(generateStructuredMock).not.toHaveBeenCalled()
    })

    it('completes early if branch has no entries', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { piggybackMode: 'off' } as never,
      })
      entriesStore.hydrate('b1', [])

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const res = await gen.next()

      expect(res).toEqual({ done: true, value: { status: 'completed' } })
      expect(generateStructuredMock).not.toHaveBeenCalled()
    })

    it('handles generateStructured failure gracefully', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { models: {} } as never,
      })
      entriesStore.hydrate('b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'The hero enters the dark forest.',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])

      generateStructuredMock.mockResolvedValueOnce({ status: 'failed', detail: 'LLM error' })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const res = await gen.next()

      expect(res).toEqual({ done: true, value: { status: 'completed' } })
      expect(generateStructuredMock).toHaveBeenCalledWith(
        'classifier',
        expect.stringContaining('The hero enters the dark forest.'),
        expect.anything(),
        expect.anything(),
        ctx.abortSignal,
      )
    })

    it('emits delta events and updates metadata when generateStructured succeeds', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { models: {} } as never,
      })
      entriesStore.hydrate('b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'Starting point',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
        {
          id: 'entry-2',
          branchId: 'b1',
          position: 2,
          content: 'Next step in forest',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 5,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const events = []
      let result = await gen.next()
      while (!result.done) {
        events.push(result.value)
        result = await gen.next()
      }

      expect(result.value).toEqual({ status: 'completed' })
      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0]).toEqual({
        type: 'delta_emitted',
        action: expect.objectContaining({
          kind: 'updateStoryEntryMetadata',
          source: 'per_turn_classifier',
          payload: expect.objectContaining({
            branchId: 'b1',
            id: 'entry-2',
            metadata: expect.objectContaining({
              sceneEntities: [],
              worldTime: 105,
            }),
          }),
        }),
      })
    })

    it('prompts with a bracketed-ID list of active/staged entities and resolves the returned placeholder back to the real id', async () => {
      const heroId = 'char_00000000-0000-4000-8000-000000000001'
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { models: {} } as never,
      })
      entriesStore.hydrate('b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'Starting point',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
        {
          id: 'entry-2',
          branchId: 'b1',
          position: 2,
          content: 'Hero steps into the clearing',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [
        {
          id: heroId,
          branchId: 'b1',
          kind: 'character',
          status: 'active',
          name: 'Hero',
        } as never,
      ])

      // The classifier only ever sees the bracketed placeholder, same as the
      // narrative model — it emits 'c1' back, never heroId directly.
      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: ['c1'],
          currentLocation: undefined,
          worldTimeDelta: 5,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const events = []
      let result = await gen.next()
      while (!result.done) {
        events.push(result.value)
        result = await gen.next()
      }

      expect(generateStructuredMock).toHaveBeenCalledWith(
        'classifier',
        expect.stringContaining(`[c1] Hero (character)`),
        expect.anything(),
        expect.anything(),
        ctx.abortSignal,
      )
      expect(events[0]).toEqual({
        type: 'delta_emitted',
        action: expect.objectContaining({
          kind: 'updateStoryEntryMetadata',
          payload: expect.objectContaining({
            metadata: expect.objectContaining({ sceneEntities: [heroId] }),
          }),
        }),
      })
    })

    it('safely ignores unknown entity IDs in visualChanges when classifier emits unmapped placeholders', async () => {
      const heroId = 'char_00000000-0000-4000-8000-000000000001'
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { models: {} } as never,
      })
      entriesStore.hydrate('b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'Starting point',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
        {
          id: 'entry-2',
          branchId: 'b1',
          position: 2,
          content: 'Hero steps into the clearing with Andrea',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [
        {
          id: heroId,
          branchId: 'b1',
          kind: 'character',
          status: 'active',
          name: 'Hero',
        } as never,
      ])

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: ['c1'],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [{ id: 'Andrea', type: 'attire', text: 'red cloak' }],
          transfers: { items: [], stackables: [] },
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const events = []
      let result = await gen.next()
      while (!result.done) {
        events.push(result.value)
        result = await gen.next()
      }

      expect(result.value).toEqual({ status: 'completed' })
      const visualDeltaEvents = events.filter(
        (e) => e.type === 'delta_emitted' && e.action.kind === 'updateEntityVisualState',
      )
      expect(visualDeltaEvents).toEqual([])
    })

    it('rerolls generateClassifierState when initial result has negative worldTimeDelta and returns second successful result', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { models: {} } as never,
      })
      entriesStore.hydrate('b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'Hero steps into the clearing',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])

      generateStructuredMock
        .mockResolvedValueOnce({
          status: 'ok',
          value: {
            sceneEntities: [],
            currentLocation: undefined,
            worldTimeDelta: -10,
            visualChanges: [],
            transfers: { items: [], stackables: [] },
          },
        })
        .mockResolvedValueOnce({
          status: 'ok',
          value: {
            sceneEntities: [],
            currentLocation: undefined,
            worldTimeDelta: 15,
            visualChanges: [],
            transfers: { items: [], stackables: [] },
          },
        })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const events = []
      let result = await gen.next()
      while (!result.done) {
        events.push(result.value)
        result = await gen.next()
      }

      expect(result.value).toEqual({ status: 'completed' })
      expect(generateStructuredMock).toHaveBeenCalledTimes(2)
      expect(events[0]).toEqual({
        type: 'delta_emitted',
        action: expect.objectContaining({
          kind: 'updateStoryEntryMetadata',
          payload: expect.objectContaining({
            metadata: expect.objectContaining({ worldTime: 15 }),
          }),
        }),
      })
    })

    it('retains original negative result when reroll call fails in generateClassifierState', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: { models: {} } as never,
      })
      entriesStore.hydrate('b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'Hero steps into the clearing',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])

      generateStructuredMock
        .mockResolvedValueOnce({
          status: 'ok',
          value: {
            sceneEntities: [],
            currentLocation: undefined,
            worldTimeDelta: -10,
            visualChanges: [],
            transfers: { items: [], stackables: [] },
          },
        })
        .mockResolvedValueOnce({
          status: 'failed',
          detail: 'provider timeout on reroll',
        })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: {} as never,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const events = []
      let result = await gen.next()
      while (!result.done) {
        events.push(result.value)
        result = await gen.next()
      }

      expect(result.value).toEqual({ status: 'completed' })
      expect(generateStructuredMock).toHaveBeenCalledTimes(2)
      expect(events[0]).toEqual({
        type: 'delta_emitted',
        action: expect.objectContaining({
          kind: 'updateStoryEntryMetadata',
          payload: expect.objectContaining({
            metadata: expect.objectContaining({ worldTime: 0 }),
          }),
        }),
      })
    })
  })

  describe('PIGGYBACK_FALLBACK_RESOLVES and preflight', () => {
    const provider = {
      id: 'prov-1',
      type: 'anthropic' as const,
      displayName: 'Anthropic',
      apiKey: 'key',
      favoriteModelIds: [],
      cachedModels: [
        {
          id: 'model-reliable',
          capabilities: { taggedBlockReliable: true },
        },
      ],
    }

    const testPipeline: Pipeline = {
      kind: 'per-turn-test',
      phases: [
        {
          name: 'piggyback-fallback-classifier',
          run: piggybackFallbackClassifierPhase,
          resolves: PIGGYBACK_FALLBACK_RESOLVES,
        },
      ],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    }

    it('declares resolver targeting classifier when piggyback is off', () => {
      const resolver = PIGGYBACK_FALLBACK_RESOLVES[0]
      expect(resolver.target).toBe('classifier')

      expect(
        resolver.when?.({
          appSettings: {
            ...APP_SETTINGS_DEFAULTS,
            providers: [provider],
            profiles: [
              {
                id: 'prof-narrative',
                kind: 'narrative',
                name: 'Narrative',
                modelRef: { providerId: 'prov-1', modelId: 'model-reliable' },
              },
            ],
            assignments: {},
            defaultProviderId: provider.id,
          },
          storySettings: { piggybackMode: 'off' } as never,
        }),
      ).toBe(true)
    })

    it('declares classifier resolver input when piggybackMode is off and fails preflight if classifier is unassigned', () => {
      const snapshot: PreflightSnapshot = {
        appSettings: {
          ...APP_SETTINGS_DEFAULTS,
          providers: [provider],
          profiles: [
            {
              id: 'prof-narrative',
              kind: 'narrative',
              name: 'Narrative',
              modelRef: { providerId: 'prov-1', modelId: 'model-reliable' },
            },
          ],
          assignments: {}, // classifier missing
          defaultProviderId: provider.id,
        },
        storySettings: { piggybackMode: 'off' } as never,
      }

      const result = runPreflight(testPipeline, snapshot)
      expect(result).toEqual({
        kind: 'config-resolver',
        failure: 'no-profile-assigned',
        target: 'classifier',
        phaseName: 'piggyback-fallback-classifier',
      })
    })

    it('passes preflight when piggybackMode is on with capability-flagged model even if classifier assignment is missing', () => {
      const snapshot: PreflightSnapshot = {
        appSettings: {
          ...APP_SETTINGS_DEFAULTS,
          providers: [provider],
          profiles: [
            {
              id: 'prof-narrative',
              kind: 'narrative',
              name: 'Narrative',
              modelRef: { providerId: 'prov-1', modelId: 'model-reliable' },
            },
          ],
          assignments: {}, // classifier missing, but piggyback is on with reliable model
          defaultProviderId: provider.id,
        },
        storySettings: { piggybackMode: 'on' } as never,
      }

      const result = runPreflight(testPipeline, snapshot)
      expect(result).toBeNull()
    })
  })
})
