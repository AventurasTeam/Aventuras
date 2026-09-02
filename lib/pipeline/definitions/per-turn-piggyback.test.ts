import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS, STORY_SETTINGS_DEFAULTS, type StorySettings } from '@/lib/db'
import { logger, makeLogger } from '@/lib/diagnostics'
import { IdBiMap } from '@/lib/ids'
import { runPreflight } from '@/lib/pipeline/runtime/preflight'
import type { Pipeline, PreflightSnapshot } from '@/lib/pipeline/types'
import { currentStoryStore, entitiesStore, resetAllStores } from '@/lib/stores'

import { createPhaseDb, hydrateEntries, resetPhaseDb, type PhaseDb } from './__tests__/phase-db'
import {
  fallbackClassifierSchema,
  fallbackClassifierWithSuggestionsSchema,
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

// Both settings writers gate on storySettingsSchema.parse before
// currentStoryStore.set, so a partial settings object never reaches
// production — fixtures use a full default instead of `as never`.
function baseSettings(overrides: Partial<StorySettings> = {}): StorySettings {
  return { ...STORY_SETTINGS_DEFAULTS, ...overrides }
}

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

let phaseDb: PhaseDb

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

describe('per-turn-piggyback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    generateStructuredMock.mockReset()
    resetAllStores()
    resetPhaseDb(phaseDb)
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
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const res = await gen.next()

      expect(res).toEqual({
        done: true,
        value: {
          status: 'failed',
          error: {
            kind: 'orchestrator',
            detail: 'piggyback-fallback-classifier: no open story for branch',
          },
        },
      })
    })

    // Same working-set guards the retrieval and narrative folds carry: this
    // phase writes scene state back onto the tail entry, so a store hydrated
    // for another branch would classify one branch's prose against another's
    // cast and land the patch on the wrong row.
    it.each([
      {
        case: 'the open story is another branch',
        open: { storyId: 's1', branchId: 'b2' },
        loaded: 'b1',
        detail: 'piggyback-fallback-classifier: no open story for branch',
      },
      {
        case: 'the open story is another story',
        open: { storyId: 's2', branchId: 'b1' },
        loaded: 'b1',
        detail: 'piggyback-fallback-classifier: no open story for branch',
      },
      {
        case: 'the entries store holds another branch',
        open: { storyId: 's1', branchId: 'b1' },
        loaded: 'b2',
        detail: 'piggyback-fallback-classifier: entries store loaded for another branch',
      },
    ])('refuses a desynced store when $case', async ({ open, loaded, detail }) => {
      currentStoryStore.set({
        ...open,
        definition,
        settings: baseSettings({ piggybackMode: 'off' }),
      })
      hydrateEntries(phaseDb, loaded, [])

      const gen = piggybackFallbackClassifierPhase({
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      })
      const res = await gen.next()

      expect(res).toEqual({
        done: true,
        value: { status: 'failed', error: { kind: 'orchestrator', detail } },
      })
      expect(generateStructuredMock).not.toHaveBeenCalled()
    })

    // Positive control for the three refusals above: the same setup with every
    // identity agreeing runs the phase instead of failing it.
    it('runs when the open story and the entries store both match the run', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ piggybackMode: 'off' }),
      })
      hydrateEntries(phaseDb, 'b1', [])

      const gen = piggybackFallbackClassifierPhase({
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      })
      const res = await gen.next()

      expect(res).toEqual({ done: true, value: { status: 'completed' } })
    })

    it('completes early without calling generateStructured if fallback should not fire', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ piggybackMode: 'on' }),
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: {
          piggybackOutcome: { attempted: true, succeeded: true } satisfies PiggybackOutcome,
        },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
        settings: baseSettings({ piggybackMode: 'off' }),
      })
      hydrateEntries(phaseDb, 'b1', [])
      entitiesStore.hydrate('b1', [])

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
        settings: baseSettings({ models: {} }),
      })
      hydrateEntries(phaseDb, 'b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'The hero enters the dark forest.',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])

      generateStructuredMock.mockResolvedValueOnce({ status: 'failed', detail: 'LLM error' })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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

    // The pair is a pipeline contract, not a share of the prompt budget: the
    // user's action can carry the state change ("I put the sword away"), so a
    // story whose buffer knobs cut `entries` to a single row must still send
    // both turns. partialChapterBuffer 1 with no protected floor is exactly
    // that cut.
    it('classifies both turns even when the buffer knobs would cut them to one', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ models: {}, partialChapterBuffer: 1, protectedBuffer: 0 }),
      })
      hydrateEntries(phaseDb, 'b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          kind: 'user_action',
          content: 'I put the sword away.',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
        {
          id: 'entry-2',
          branchId: 'b1',
          position: 2,
          kind: 'ai_reply',
          content: 'The blade slides home.',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])
      generateStructuredMock.mockResolvedValueOnce({ status: 'failed', detail: 'LLM error' })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      await piggybackFallbackClassifierPhase(ctx).next()

      const prompt = generateStructuredMock.mock.calls.at(-1)?.[1] as string
      expect(prompt).toContain('I put the sword away.')
      expect(prompt).toContain('The blade slides home.')
    })

    // The prompt's turn pair and the row the patch lands on must be the same two
    // rows. A store lagging the branch tail is what tells them apart: the second
    // hydrate rewinds the window without removing anything from the database.
    it('targets the turn pair the prompt rendered, not the entries store window', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ models: {} }),
      })
      const rows = [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          kind: 'user_action',
          content: 'I put the sword away.',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
        {
          id: 'entry-2',
          branchId: 'b1',
          position: 2,
          kind: 'ai_reply',
          content: 'The blade slides home.',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ]
      hydrateEntries(phaseDb, 'b1', rows)
      hydrateEntries(phaseDb, 'b1', rows.slice(0, 1))
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
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const first = await gen.next()

      const prompt = generateStructuredMock.mock.calls.at(-1)?.[1] as string
      expect(prompt).toContain('The blade slides home.')
      expect(first.value).toEqual({
        type: 'delta_emitted',
        action: expect.objectContaining({
          kind: 'updateStoryEntryMetadata',
          payload: expect.objectContaining({
            id: 'entry-2',
            // 100 from entry-1, the row the prompt showed as the previous turn —
            // a window that ended at entry-1 would have had no previous row and
            // started the delta from 0.
            metadata: expect.objectContaining({ worldTime: 105 }),
          }),
        }),
      })
    })

    it('emits delta events and updates metadata when generateStructured succeeds', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ models: {} }),
      })
      hydrateEntries(phaseDb, 'b1', [
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
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
        settings: baseSettings({ models: {} }),
      })
      hydrateEntries(phaseDb, 'b1', [
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
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
        settings: baseSettings({ models: {} }),
      })
      hydrateEntries(phaseDb, 'b1', [
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
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
        settings: baseSettings({ models: {} }),
      })
      hydrateEntries(phaseDb, 'b1', [
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
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
        settings: baseSettings({ models: {} }),
      })
      hydrateEntries(phaseDb, 'b1', [
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
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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

  describe('classifier fold — suggestions', () => {
    function runningEntries() {
      hydrateEntries(phaseDb, 'b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'Hero steps into the clearing',
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 100 },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])
    }

    it('asks the classifier for chips and persists them with source classifier, as one metadata delta', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 5,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
          suggestions: [
            { categoryRef: 'cat1', text: 'Draw the blade.' },
            { categoryRef: 'cat2', text: '"Who sent you?"' },
          ],
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
      expect(generateStructuredMock).toHaveBeenCalledWith(
        'classifier',
        expect.any(String),
        fallbackClassifierWithSuggestionsSchema,
        expect.anything(),
        ctx.abortSignal,
      )
      // One delta carries both scene state and chips — a second
      // updateStoryEntryMetadata delta here would mean the fold is patching
      // the entry twice for what must be a single write.
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'delta_emitted',
        action: expect.objectContaining({
          kind: 'updateStoryEntryMetadata',
          payload: expect.objectContaining({
            metadata: expect.objectContaining({
              nextTurnSuggestions: {
                items: [
                  { categoryId: 'cat_action', text: 'Draw the blade.' },
                  { categoryId: 'cat_dialogue', text: '"Who sent you?"' },
                ],
                source: 'classifier',
              },
            }),
          }),
        }),
      })
    })

    it('does not ask for or write chips when suggestionsCaptured is already true (state-only refire)', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

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
        intermediates: {
          idMap: new IdBiMap(),
          piggybackOutcome: { attempted: true, succeeded: false } satisfies PiggybackOutcome,
          suggestionsCaptured: true,
        },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
      expect(generateStructuredMock).toHaveBeenCalledWith(
        'classifier',
        expect.any(String),
        fallbackClassifierSchema,
        expect.anything(),
        ctx.abortSignal,
      )
      const created = events[0]
      if (
        !created ||
        created.type !== 'delta_emitted' ||
        created.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      expect(created.action.payload.metadata.nextTurnSuggestions).toBeUndefined()
    })

    it('preserves narrative-fold chips already on the tail entry on a state-only refire (row 3 clobber guard)', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      const existingChips = {
        items: [{ categoryId: 'cat_action', text: 'Draw the blade.' }],
        source: 'piggyback' as const,
      }
      hydrateEntries(phaseDb, 'b1', [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          content: 'Hero steps into the clearing',
          metadata: {
            sceneEntities: [],
            currentLocationId: null,
            worldTime: 100,
            nextTurnSuggestions: existingChips,
          },
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
        intermediates: {
          idMap: new IdBiMap(),
          piggybackOutcome: { attempted: true, succeeded: false } satisfies PiggybackOutcome,
          suggestionsCaptured: true,
        },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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

      const created = events[0]
      if (
        !created ||
        created.type !== 'delta_emitted' ||
        created.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      // This phase re-rolls state alone (row 3: <state> failed, <suggestions>
      // already in hand) — it must not fire a second suggestion call and must not
      // drop the chips the narrative fold already wrote. The payload claims only
      // what this phase computed, so omitting the key IS the guarantee: the
      // handler merges onto the stored row and leaves the chips standing.
      expect(created.action.payload.metadata).not.toHaveProperty('nextTurnSuggestions')
      // Folded from an absent previous entry (this row is itself the tail), so the
      // emitted delta of 5 lands on a base of 0.
      expect(created.action.payload.metadata.worldTime).toBe(5)
    })

    it('does not fire the phase at all when state succeeded, regardless of suggestionsCaptured (purely state-driven)', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: {
          idMap: new IdBiMap(),
          piggybackOutcome: { attempted: true, succeeded: true } satisfies PiggybackOutcome,
          // Chips failed to parse on the narrative fold, but state itself is
          // fine — shouldFallbackFire must not fire just to chase chips.
          suggestionsCaptured: false,
        },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      const res = await gen.next()

      expect(res).toEqual({ done: true, value: { status: 'completed' } })
      expect(generateStructuredMock).not.toHaveBeenCalled()
    })

    it('uses the base schema and omits chips when suggestionsEnabled is false', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: false,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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
        expect.any(String),
        fallbackClassifierSchema,
        expect.anything(),
        ctx.abortSignal,
      )
      const prompt = generateStructuredMock.mock.calls[0]?.[1] as string
      expect(prompt).not.toContain('Action')
      const created = events[0]
      if (
        !created ||
        created.type !== 'delta_emitted' ||
        created.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      expect(created.action.payload.metadata.nextTurnSuggestions).toBeUndefined()
    })

    it('renders the slot list and suggestionCount, and excludes disabled categories', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: [
            ...SUGGESTION_CATEGORIES,
            {
              id: 'cat_hidden',
              label: 'Hidden',
              promptHint: 'nope',
              color: 'gray',
              enabled: false,
              order: 2,
            },
          ],
        }),
      })
      runningEntries()

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      let result = await gen.next()
      while (!result.done) {
        result = await gen.next()
      }

      const prompt = generateStructuredMock.mock.calls[0]?.[1] as string
      expect(prompt).toContain('exactly 2 distinct entries')
      expect(prompt).toContain('id "cat1" = Action — use it for: act')
      expect(prompt).toContain('id "cat2" = Dialogue — use it for: say')
      expect(prompt).toContain('one or two sentences')
      expect(prompt).not.toContain('Hidden')
      expect(prompt).not.toContain('cat3')
    })

    it('drops an item whose category ref does not resolve, keeping the rest', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
          suggestions: [
            { categoryRef: 'cat9', text: 'orphan' },
            { categoryRef: 'cat1', text: 'kept' },
          ],
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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

      const created = events[0]
      if (
        !created ||
        created.type !== 'delta_emitted' ||
        created.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      expect(created.action.payload.metadata.nextTurnSuggestions).toEqual({
        items: [{ categoryId: 'cat_action', text: 'kept' }],
        source: 'classifier',
      })
    })

    it('clamps persisted chips to suggestionCount when the model over-emits', async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
          suggestions: [
            { categoryRef: 'cat1', text: 'one' },
            { categoryRef: 'cat2', text: 'two' },
            { categoryRef: 'cat1', text: 'three' },
          ],
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: makeLogger('act_1'),
        db: phaseDb.db,
        runInTransaction: async () => undefined,
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

      const created = events[0]
      if (
        !created ||
        created.type !== 'delta_emitted' ||
        created.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      expect(created.action.payload.metadata.nextTurnSuggestions).toEqual({
        items: [
          { categoryId: 'cat_action', text: 'one' },
          { categoryId: 'cat_dialogue', text: 'two' },
        ],
        source: 'classifier',
      })
    })

    it('logs classifier.suggestions_fallback_parse_failed with the drop count when a ref does not resolve', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
          suggestions: [
            { categoryRef: 'cat9', text: 'orphan' },
            { categoryRef: 'cat1', text: 'kept' },
          ],
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: logger,
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      let result = await gen.next()
      while (!result.done) {
        result = await gen.next()
      }

      expect(warnSpy).toHaveBeenCalledWith(
        'classifier.suggestions_fallback_parse_failed',
        expect.objectContaining({ dropped: 1 }),
      )
    })

    it('logs classifier.suggestions_fallback_parse_failed when asked but the model returns nothing usable', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({
          models: {},
          suggestionsEnabled: true,
          suggestionCount: 2,
          suggestionCategories: SUGGESTION_CATEGORIES,
        }),
      })
      runningEntries()

      // Indistinguishable from a genuinely-empty reply: .catch([]) already
      // collapsed a malformed suggestions value to [] before this mock value
      // is even constructed — there is no blockFound signal on this path.
      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
          suggestions: [],
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: logger,
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      let result = await gen.next()
      while (!result.done) {
        result = await gen.next()
      }

      expect(warnSpy).toHaveBeenCalledWith(
        'classifier.suggestions_fallback_parse_failed',
        expect.objectContaining({ received: 0, dropped: 0 }),
      )
    })

    it('does not log classifier.suggestions_fallback_parse_failed when suggestions were not requested', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ models: {}, suggestionsEnabled: false }),
      })
      runningEntries()

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: { items: [], stackables: [] },
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: { idMap: new IdBiMap() },
        log: logger,
        db: phaseDb.db,
        runInTransaction: async () => undefined,
        storyId: 's1',
        branchId: 'b1',
      }

      const gen = piggybackFallbackClassifierPhase(ctx)
      let result = await gen.next()
      while (!result.done) {
        result = await gen.next()
      }

      expect(warnSpy).not.toHaveBeenCalledWith(
        'classifier.suggestions_fallback_parse_failed',
        expect.anything(),
      )
    })
  })

  describe('fallbackClassifierWithSuggestionsSchema', () => {
    it('degrades a malformed (non-array) suggestions value to [] without failing the parse', () => {
      const result = fallbackClassifierWithSuggestionsSchema.safeParse({
        sceneEntities: [],
        worldTimeDelta: 5,
        suggestions: 'not-an-array',
      })

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('expected parse to succeed')
      expect(result.data.suggestions).toEqual([])
      // The .catch([]) guarantee: a malformed suggestions value must not take
      // the sibling scene-state field down with it.
      expect(result.data.worldTimeDelta).toBe(5)
    })

    it('degrades an array with one malformed item to [] wholesale (no itemwise recovery)', () => {
      const result = fallbackClassifierWithSuggestionsSchema.safeParse({
        sceneEntities: [],
        worldTimeDelta: 5,
        suggestions: [{ categoryRef: 'cat1', text: 'ok' }, { oops: true }],
      })

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('expected parse to succeed')
      expect(result.data.suggestions).toEqual([])
    })

    it('still fails the whole parse when a sibling scene-state field is malformed', () => {
      const result = fallbackClassifierWithSuggestionsSchema.safeParse({
        sceneEntities: [],
        worldTimeDelta: 'not-a-number',
        suggestions: [{ categoryRef: 'cat1', text: 'ok' }],
      })

      expect(result.success).toBe(false)
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
