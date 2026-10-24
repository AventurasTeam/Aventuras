import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { PromptHalves } from '@/lib/ai'
import {
  APP_SETTINGS_DEFAULTS,
  emptyEntityState,
  STORY_SETTINGS_DEFAULTS,
  type Entity,
  type EntryMetadata,
  type StoryEntry,
  type StorySettings,
} from '@/lib/db'
import { logger, makeLogger, type Logger } from '@/lib/diagnostics'
import { IdBiMap } from '@/lib/ids'
import { runPreflight } from '@/lib/pipeline/runtime/preflight'
import type { PhaseEmittedEvent, Pipeline, PreflightSnapshot } from '@/lib/pipeline/types'
import { bundledPack, MACRO_IDS } from '@/lib/prompts'
import type { EntityRow, LoreRow, RetrievalSuccess } from '@/lib/retrieval'
import { retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'
import { currentStoryStore, entitiesStore, resetAllStores } from '@/lib/stores'

import { createPhaseDb, hydrateEntries, resetPhaseDb, type PhaseDb } from './__tests__/phase-db'
import { __resetClassifierEmbedder, configureClassifierEmbedder } from './description-embedder'
import { RETRIEVAL_INTERMEDIATE_KEY } from './intermediates'
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

    it('records a failure report when the classifier call fails', async () => {
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
      const events = []
      let next = await gen.next()
      while (!next.done) {
        events.push(next.value)
        next = await gen.next()
      }

      expect(next.value).toEqual({ status: 'completed' })
      expect(generateStructuredMock).toHaveBeenCalledWith(
        'classifier',
        {
          system: expect.any(String),
          user: expect.stringContaining('The hero enters the dark forest.'),
        },
        expect.anything(),
        expect.anything(),
        ctx.abortSignal,
        { cacheSystemPrefix: true },
      )

      // With the narrative fold having written no report, this phase is the only writer:
      // returning completed without one leaves the row saying nothing happened.
      const written = events.find(
        (e) => e.type === 'delta_emitted' && e.action.kind === 'updateStoryEntryMetadata',
      )
      if (
        !written ||
        written.type !== 'delta_emitted' ||
        written.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected a metadata delta recording the failure')
      const report = written.action.payload.metadata.stateReport
      expect(report?.layer).toBe('per_turn_classifier')
      expect(report?.failedFields).toEqual([
        { field: 'classifier', detail: 'classifier call failed' },
      ])
    })

    // The fold applied its visual changes and transfers before its own parse failed, so
    // those entity rows exist. A report rebuilt from an empty block would deny them, and
    // a per_turn_classifier badge would credit fields to a call that never returned.
    it('amends the fold report rather than replacing it when the classifier call fails', async () => {
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
          metadata: {
            sceneEntities: [],
            currentLocationId: null,
            worldTime: 100,
            stateReport: {
              layer: 'piggyback_tagged_block',
              visualChanges: [{ id: 'char_a', type: 'attire', text: 'muddied cloak' }],
              failedFields: [{ field: 'transfers', detail: 'no well-formed entries' }],
              raw: '<state><transfers><item id="i1"',
            },
          },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])

      generateStructuredMock.mockResolvedValueOnce({ status: 'failed', detail: 'LLM error' })

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
      const events = []
      let next = await gen.next()
      while (!next.done) {
        events.push(next.value)
        next = await gen.next()
      }

      const written = events.find(
        (e) => e.type === 'delta_emitted' && e.action.kind === 'updateStoryEntryMetadata',
      )
      if (
        !written ||
        written.type !== 'delta_emitted' ||
        written.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected a metadata delta recording the failure')
      const report = written.action.payload.metadata.stateReport
      expect(report?.layer).toBe('piggyback_tagged_block')
      expect(report?.visualChanges).toEqual([
        { id: 'char_a', type: 'attire', text: 'muddied cloak' },
      ])
      expect(report?.raw).toBe('<state><transfers><item id="i1"')
      expect(report?.failedFields).toEqual([
        { field: 'transfers', detail: 'no well-formed entries' },
        { field: 'classifier', detail: 'classifier call failed' },
      ])
    })

    // Cancelling mid-call is not a classifier failure: the run discards its writes, and
    // a durable failure report would outlive the turn the user threw away.
    it('discards the write when the classifier call is aborted', async () => {
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

      generateStructuredMock.mockResolvedValueOnce({ status: 'aborted' })

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
      const events = []
      let next = await gen.next()
      while (!next.done) {
        events.push(next.value)
        next = await gen.next()
      }

      expect(next.value).toEqual({ status: 'aborted' })
      expect(events).toEqual([])
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

      const prompt = (generateStructuredMock.mock.calls.at(-1)?.[1] as PromptHalves).user
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

      const prompt = (generateStructuredMock.mock.calls.at(-1)?.[1] as PromptHalves).user
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

    // Canon: Q4 on both per-turn implementations; this is the one the default piggybackMode:
    // 'off' story actually runs (docs/memory/retrieval.md → Q4).
    it("carries the fallback classifier's emitted queries onto the entry metadata", async () => {
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

      // Routed through the real schema's .parse(), not a hand-built literal — otherwise the mock
      // smuggles a field the schema no longer declares, defeating the mutation check.
      const value = fallbackClassifierSchema.parse({
        sceneEntities: [],
        currentLocation: undefined,
        worldTimeDelta: 0,
        visualChanges: [],
        transfers: { items: [], stackables: [] },
        retrievalQueries: ['House Eldrin sigil'],
      })
      generateStructuredMock.mockResolvedValueOnce({ status: 'ok', value })

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
      expect(events[0]).toEqual({
        type: 'delta_emitted',
        action: expect.objectContaining({
          kind: 'updateStoryEntryMetadata',
          source: 'per_turn_classifier',
          payload: expect.objectContaining({
            branchId: 'b1',
            id: 'entry-2',
            metadata: expect.objectContaining({
              retrievalQueries: ['House Eldrin sigil'],
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
          keywords: [],
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
        { system: expect.any(String), user: expect.stringContaining(`[c1] Hero (character)`) },
        expect.anything(),
        expect.anything(),
        ctx.abortSignal,
        { cacheSystemPrefix: true },
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
          keywords: [],
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

    it('drops the stackable transfers the tagged-block parser would reject, keeping the valid one', async () => {
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
          content: 'Hero haggles at the stall',
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
          keywords: [],
          state: { stackables: { gold: 10 } },
        } as never,
      ])

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: ['c1'],
          currentLocation: undefined,
          worldTimeDelta: 0,
          visualChanges: [],
          transfers: {
            items: [],
            stackables: [
              { key: 'Silver', amount: 3, to: 'c1' },
              { key: 'gold', amount: -5, from: 'c1' },
              { key: 'copper', amount: 1.5, to: 'c1' },
              { key: '  ', amount: 2, to: 'c1' },
              { key: 'x'.repeat(41), amount: 2, to: 'c1' },
            ],
          },
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
      const stackableWrites = events.flatMap((e) =>
        e.type === 'delta_emitted' && e.action.kind === 'updateEntityStackables'
          ? [e.action.payload]
          : [],
      )
      expect(stackableWrites).toEqual([
        { branchId: 'b1', id: heroId, stackables: { gold: 10, silver: 3 } },
      ])
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

    // architecture.md → System and user halves; piggyback.md → Fallback classifier context.
    describe('cache marker', () => {
      const REPORT = {
        sceneEntities: [],
        currentLocation: undefined,
        visualChanges: [],
        transfers: { items: [], stackables: [] },
      }

      async function callOptionsAfter(
        outcome: PiggybackOutcome | undefined,
        { worldTimeDeltas = [15], withChips = false } = {},
      ): Promise<unknown[]> {
        currentStoryStore.set({
          storyId: 's1',
          branchId: 'b1',
          definition,
          settings: baseSettings({
            models: {},
            ...(withChips
              ? {
                  suggestionsEnabled: true,
                  suggestionCount: 2,
                  suggestionCategories: SUGGESTION_CATEGORIES,
                }
              : {}),
          }),
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
        for (const worldTimeDelta of worldTimeDeltas)
          generateStructuredMock.mockResolvedValueOnce({
            status: 'ok',
            value: { ...REPORT, worldTimeDelta, ...(withChips ? { suggestions: [] } : {}) },
          })

        const gen = piggybackFallbackClassifierPhase({
          actionId: 'act_1',
          abortSignal: new AbortController().signal,
          intermediates: {
            idMap: new IdBiMap(),
            ...(outcome ? { piggybackOutcome: outcome } : {}),
          },
          log: makeLogger('act_1'),
          db: phaseDb.db,
          runInTransaction: async () => undefined,
          storyId: 's1',
          branchId: 'b1',
        })
        let result = await gen.next()
        while (!result.done) result = await gen.next()
        return generateStructuredMock.mock.calls.map((call) => call[5])
      }

      // Both schema branches: a recovery that also asks for chips stays unmarked.
      describe.each([
        ['the base schema', false],
        ['the schema with chips', true],
      ])('on %s', (_schema, withChips) => {
        it.each([
          ['no piggyback outcome', undefined],
          ['a piggyback that never fired', { attempted: false, succeeded: false }],
        ])('marks the regular classifier call after %s', async (_label, outcome) => {
          expect(await callOptionsAfter(outcome, { withChips })).toEqual([
            { cacheSystemPrefix: true },
          ])
        })

        it('leaves a call recovering from a failed piggyback parse unmarked', async () => {
          expect(
            await callOptionsAfter({ attempted: true, succeeded: false }, { withChips }),
          ).toEqual([{ cacheSystemPrefix: false }])
        })

        it.each([
          ['the regular classifier', undefined, true],
          ['a recovery', { attempted: true, succeeded: false }, false],
        ])(
          "re-rolls a negative delta from %s with the first call's options",
          async (_label, outcome, cacheSystemPrefix) => {
            expect(
              await callOptionsAfter(outcome, { worldTimeDeltas: [-10, 15], withChips }),
            ).toEqual([{ cacheSystemPrefix }, { cacheSystemPrefix }])
          },
        )
      })
    })

    // Here, not the template's own test file: buildGenerationContext gates the read on a
    // variable the template never names — mistyped, it silently empties instead of erroring.
    describe('fallback classifier context (piggyback.md → Fallback classifier context)', () => {
      const KEEP = 'loc_00000000-0000-4000-8000-0000000000a1'
      const KAEL = 'char_00000000-0000-4000-8000-000000000001'

      const entity = (id: string, name: string, description: string | null = null): EntityRow => ({
        id,
        kind: 'character',
        status: 'active',
        injectionMode: 'auto',
        name,
        description,
      })

      const place = (id: string, name: string, description: string): EntityRow => ({
        ...entity(id, name, description),
        kind: 'location',
      })

      const lore = (id: string, title: string, body: string): LoreRow => ({
        id,
        title,
        body,
        injectionMode: 'always',
        priority: 0,
      })

      /**
       * Renders the phase's prompt and returns it. The classifier call is mocked to fail,
       * so the run stops at the resulting report — one `.next()` past the render.
       */
      async function renderFallbackPrompt(
        over: {
          settings?: Partial<StorySettings>
          entries?: string[]
          sceneEntities?: string[]
          entities?: EntityRow[]
          retrieval?: RetrievalSuccess
          kinds?: StoryEntry['kind'][]
          worldTimes?: number[]
        } = {},
      ): Promise<PromptHalves> {
        currentStoryStore.set({
          storyId: 's1',
          branchId: 'b1',
          definition,
          settings: baseSettings({ models: {}, ...over.settings }),
        })
        const contents = over.entries ?? ['I put the sword away.', 'The blade slides home.']
        if (over.kinds && over.kinds.length !== contents.length)
          throw new Error('kinds must have one entry per content string')
        if (over.worldTimes && over.worldTimes.length !== contents.length)
          throw new Error('worldTimes must have one entry per content string')
        hydrateEntries(
          phaseDb,
          'b1',
          contents.map(
            (content, i) =>
              ({
                id: `entry-${i + 1}`,
                branchId: 'b1',
                position: i + 1,
                kind: over.kinds?.[i] ?? (i % 2 === 0 ? 'user_action' : 'ai_reply'),
                content,
                metadata: {
                  sceneEntities: i === contents.length - 1 ? (over.sceneEntities ?? []) : [],
                  currentLocationId: null,
                  worldTime: over.worldTimes?.[i] ?? 100,
                },
              }) as never,
          ),
        )
        entitiesStore.hydrate(
          'b1',
          (over.entities ?? []).map((e) => ({ branchId: 'b1', ...e })) as never[],
        )

        const intermediates: Record<string, unknown> = { idMap: new IdBiMap() }
        if (over.retrieval) intermediates[RETRIEVAL_INTERMEDIATE_KEY] = over.retrieval

        generateStructuredMock.mockResolvedValueOnce({ status: 'failed', detail: 'LLM error' })
        await piggybackFallbackClassifierPhase({
          actionId: 'act_1',
          abortSignal: new AbortController().signal,
          intermediates,
          log: makeLogger('act_1'),
          db: phaseDb.db,
          runInTransaction: async () => undefined,
          storyId: 's1',
          branchId: 'b1',
        }).next()

        // A phase that grew a yield before the render would otherwise surface as a
        // TypeError inside toContain rather than as a failed expectation.
        expect(generateStructuredMock).toHaveBeenCalledOnce()
        return generateStructuredMock.mock.calls[0]![1] as PromptHalves
      }

      it('renders the memory blocks, in-scene and location sections, and the calendar', async () => {
        const { system, user } = await renderFallbackPrompt({
          entities: [entity(KAEL, 'Kael', 'A courier with a stolen sigil.')],
          sceneEntities: [KAEL],
          retrieval: retrievalSuccess({
            floor: {
              currentLocation: place(KEEP, 'The Drowned Keep', 'Half sunk.'),
              alwaysLore: [lore('lore_1', 'House Eldrin', 'An exiled line.')],
            },
          }),
        })

        expect(user).toContain('# In scene')
        expect(user).toContain('A courier with a stolen sigil.')
        expect(user).toContain('# Current location')
        expect(user).toContain('The Drowned Keep')
        expect(user).toContain('Half sunk.')
        expect(user).toContain('# Relevant lore')
        expect(user).toContain('An exiled line.')
        expect(user).toContain('# This turn')
        // piggyback.md → Fallback classifier context: the calendar is the whole system half.
        expect(system).toMatch(
          /^# Calendar\nThis story tracks time in seconds .+ into a seconds delta using these units\.$/,
        )
        expect(user).not.toContain('# Calendar')
      })

      // Unreachable in production (narrative always fills the tail with ai_reply first) —
      // forced here because the realistic shape can't discriminate a dropped variable.
      it('states the sinceUserAction basis when the tail advanced time on its own action', async () => {
        const prompt = await renderFallbackPrompt({
          kinds: ['ai_reply', 'user_action'],
          worldTimes: [100, 200],
        })

        expect(prompt.user).toContain("since the end of the user's action")
        expect(prompt.user).toContain('never negative')
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
        { system: expect.any(String), user: expect.any(String) },
        fallbackClassifierWithSuggestionsSchema,
        expect.anything(),
        ctx.abortSignal,
        { cacheSystemPrefix: true },
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
        { system: expect.any(String), user: expect.any(String) },
        fallbackClassifierSchema,
        expect.anything(),
        ctx.abortSignal,
        { cacheSystemPrefix: false },
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

    it('names itself as the layer while retaining the failed narrative attempt', async () => {
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
          metadata: {
            sceneEntities: [],
            currentLocationId: null,
            worldTime: 100,
            // What the narrative fold left behind when its block failed to parse.
            stateReport: {
              layer: 'piggyback_tagged_block',
              failedFields: [{ field: 'transfers', detail: 'truncated' }],
              raw: '<state><transfers><item id="i1"',
            },
          },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 60,
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

      const written = events[0]
      if (
        !written ||
        written.type !== 'delta_emitted' ||
        written.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      const report = written.action.payload.metadata.stateReport
      // The badge must name whoever actually supplied the fields.
      expect(report?.layer).toBe('per_turn_classifier')
      // …while the narrative fold's failure stays inspectable rather than being
      // overwritten along with the layer.
      expect(report?.failedFields).toEqual([{ field: 'transfers', detail: 'truncated' }])
      expect(report?.raw).toBe('<state><transfers><item id="i1"')
      expect(report?.worldTimeDelta).toBe(60)
    })

    it('keeps changes the narrative fold already applied when the classifier reports none', async () => {
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
          metadata: {
            sceneEntities: [],
            currentLocationId: null,
            worldTime: 100,
            // The fold parsed these and buildPiggybackActions wrote them to entity rows;
            // only sceneEntities failed, which is why the fallback is running at all.
            stateReport: {
              layer: 'piggyback_tagged_block',
              visualChanges: [{ id: 'char_1', type: 'attire', text: 'torn cloak' }],
              transfers: { items: [], stackables: [{ key: 'gold', amount: 5 }] },
              failedFields: [{ field: 'sceneEntities', detail: 'unresolvable placeholder' }],
            },
          },
        } as never,
      ])
      entitiesStore.hydrate('b1', [])

      // The classifier omits both fields, which the schema now leaves undefined rather
      // than defaulting to empty.
      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: { sceneEntities: [], currentLocation: undefined, worldTimeDelta: 60 },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: {
          idMap: new IdBiMap(),
          piggybackOutcome: { attempted: true, succeeded: false } satisfies PiggybackOutcome,
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

      const written = events[0]
      if (
        !written ||
        written.type !== 'delta_emitted' ||
        written.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      const report = written.action.payload.metadata.stateReport
      // An empty report here would tell the reader nothing changed this turn, while the
      // character's attire had in fact already been rewritten in the entity row.
      expect(report?.visualChanges).toEqual([{ id: 'char_1', type: 'attire', text: 'torn cloak' }])
      expect(report?.transfers).toEqual({ items: [], stackables: [{ key: 'gold', amount: 5 }] })
    })

    it("lets the classifier's own changes win over the fold's", async () => {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ models: {} }),
      })
      const charUuid = 'char_00000000-0000-4000-8000-0000000000a1'
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
            stateReport: {
              layer: 'piggyback_tagged_block',
              visualChanges: [{ id: charUuid, type: 'attire', text: 'torn cloak' }],
              transfers: { items: [], stackables: [{ key: 'gold', amount: 5 }] },
            },
          },
        } as never,
      ])
      // A character row, so classifier changes land: one that writes nothing keeps the fold's.
      entitiesStore.hydrate('b1', [
        {
          id: charUuid,
          branchId: 'b1',
          kind: 'character',
          status: 'active',
          name: 'Hero',
          keywords: [],
        } as never,
      ])

      // Resolvable, so substitution keeps the field and the merge must leave it alone.
      const idMap = new IdBiMap()
      const placeholder = idMap.allocate(charUuid)

      generateStructuredMock.mockResolvedValueOnce({
        status: 'ok',
        value: {
          sceneEntities: [],
          currentLocation: undefined,
          worldTimeDelta: 60,
          visualChanges: [{ id: placeholder, type: 'hair', text: 'shorn short' }],
          transfers: { items: [], stackables: [{ key: 'silver', amount: 3, to: placeholder }] },
        },
      })

      const ctx = {
        actionId: 'act_1',
        abortSignal: new AbortController().signal,
        intermediates: {
          idMap,
          piggybackOutcome: { attempted: true, succeeded: false } satisfies PiggybackOutcome,
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

      const written = events[0]
      if (
        !written ||
        written.type !== 'delta_emitted' ||
        written.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected an updateStoryEntryMetadata delta')
      expect(written.action.payload.metadata.stateReport?.visualChanges).toEqual([
        { id: charUuid, type: 'hair', text: 'shorn short' },
      ])
      expect(written.action.payload.metadata.stateReport?.transfers).toEqual({
        items: [],
        stackables: [{ key: 'silver', amount: 3, to: charUuid }],
      })
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
        { system: expect.any(String), user: expect.any(String) },
        fallbackClassifierSchema,
        expect.anything(),
        ctx.abortSignal,
        { cacheSystemPrefix: true },
      )
      const prompt = (generateStructuredMock.mock.calls[0]?.[1] as PromptHalves).user
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

      const prompt = (generateStructuredMock.mock.calls[0]?.[1] as PromptHalves).user
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

  describe('classifier fold — creates', () => {
    const HERO = 'char_00000000-0000-4000-8000-000000000001'
    const TOWN = 'loc_00000000-0000-4000-8000-0000000000a1'
    const MARKET = 'loc_00000000-0000-4000-8000-0000000000a2'
    const OLD_KEY = 'item_00000000-0000-4000-8000-0000000000b1'
    const SCENE: EntryMetadata = { sceneEntities: [HERO], currentLocationId: TOWN, worldTime: 100 }
    // l1 is TOWN (seeded in runFallback).
    const DOCKS = {
      handle: 'new:docks',
      name: 'Smuggler Docks',
      description: 'a rotting pier',
      parent: 'l1',
    }
    // What a failed narrative fold leaves on the reply: its creates reported dropped.
    const FOLD_REPORT: NonNullable<EntryMetadata['stateReport']> = {
      layer: 'piggyback_tagged_block',
      newLocations: [
        {
          handle: 'new:camp',
          name: 'Old Camp',
          description: 'a ring of stones',
          outcome: 'dropped',
        },
      ],
      newItems: [
        { handle: 'new:lamp', name: 'tin lamp', description: 'a dented lamp', outcome: 'dropped' },
      ],
      failedFields: [{ field: 'worldTimeDelta', detail: 'not a finite number: "soon"' }],
      raw: '<state><world_time_delta>soon</world_time_delta></state>',
    }

    beforeEach(() => {
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

    const fallbackWorld = (): Entity[] => [
      worldRow({
        id: HERO,
        kind: 'character',
        name: 'Aria',
        state: { ...emptyEntityState('character'), current_location_id: TOWN },
      }),
      worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
    ]

    const market = (status: Entity['status']): Entity =>
      worldRow({
        id: MARKET,
        kind: 'location',
        name: 'The Drowned Market',
        status,
        state: { parent_location_id: TOWN },
      })

    function seedFallbackTurn(
      world: Entity[] = fallbackWorld(),
      foldReport?: NonNullable<EntryMetadata['stateReport']>,
      before: EntryMetadata = SCENE,
    ): void {
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition,
        settings: baseSettings({ models: {}, suggestionsEnabled: false }),
      })
      const rows: StoryEntry[] = [
        {
          id: 'entry-1',
          branchId: 'b1',
          position: 1,
          kind: 'ai_reply',
          content: 'The tide is out at Saltmere.',
          chapterId: null,
          metadata: before,
          createdAt: 1,
        },
        {
          id: 'entry-2',
          branchId: 'b1',
          position: 2,
          kind: 'ai_reply',
          content: 'Aria goes down to the water.',
          chapterId: null,
          metadata: { ...SCENE, ...(foldReport ? { stateReport: foldReport } : {}) },
          createdAt: 2,
        },
      ]
      hydrateEntries(phaseDb, 'b1', rows)
      entitiesStore.hydrate('b1', world)
    }

    async function runFallback(
      value: unknown,
      over: { intermediates?: Record<string, unknown>; log?: Logger; signal?: AbortSignal } = {},
    ) {
      generateStructuredMock.mockResolvedValueOnce({ status: 'ok', value })
      const idMap = new IdBiMap()
      for (const id of [HERO, TOWN, MARKET]) idMap.allocate(id)
      const gen = piggybackFallbackClassifierPhase({
        actionId: 'act_1',
        abortSignal: over.signal ?? new AbortController().signal,
        intermediates: { idMap, ...over.intermediates },
        log: over.log ?? makeLogger('act_1'),
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

    const createActions = (events: readonly PhaseEmittedEvent[]) =>
      events.flatMap((e) =>
        e.type === 'delta_emitted' && e.action.kind === 'createEntity' ? [e.action] : [],
      )

    const createdEntries = (events: readonly PhaseEmittedEvent[]) =>
      createActions(events).map((action) => action.payload.entry)

    function metadataPatch(events: readonly PhaseEmittedEvent[]) {
      const update = events.find(
        (e) => e.type === 'delta_emitted' && e.action.kind === 'updateStoryEntryMetadata',
      )
      if (
        !update ||
        update.type !== 'delta_emitted' ||
        update.action.kind !== 'updateStoryEntryMetadata'
      )
        throw new Error('expected a metadata update')
      return update.action.payload.metadata
    }

    const docksAndKey = () =>
      fallbackClassifierSchema.parse({
        sceneEntities: ['c1'],
        newLocations: [DOCKS],
        currentLocation: 'new:docks',
        worldTimeDelta: 30,
        newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
        transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
      })

    it('creates a place under an existing one and an item given to a character', async () => {
      seedFallbackTurn()
      const { events, result } = await runFallback(docksAndKey())
      expect(result).toEqual({ status: 'completed' })

      const [docks, key] = createdEntries(events)
      if (!docks || !key) throw new Error('expected a location create and an item create')
      expect(docks).toMatchObject({
        kind: 'location',
        name: 'Smuggler Docks',
        state: { parent_location_id: TOWN },
      })
      expect(key).toMatchObject({
        kind: 'item',
        name: 'rusted key',
        state: { at_location_id: null },
      })
      expect(createActions(events).map((a) => a.source)).toEqual([
        'per_turn_classifier',
        'per_turn_classifier',
      ])

      const patch = metadataPatch(events)
      expect(patch.currentLocationId).toBe(docks.id)
      expect(patch.stateReport).toMatchObject({
        layer: 'per_turn_classifier',
        currentLocation: docks.id,
        newLocations: [
          {
            handle: 'new:docks',
            name: 'Smuggler Docks',
            description: 'a rotting pier',
            parent: TOWN,
            outcome: 'created',
            id: docks.id,
          },
        ],
        newItems: [
          {
            handle: 'new:key',
            name: 'rusted key',
            description: 'an iron key',
            outcome: 'created',
            id: key.id,
          },
        ],
      })
      expect(events).toContainEqual({
        type: 'delta_emitted',
        action: {
          kind: 'updateEntityInventory',
          source: 'per_turn_classifier',
          payload: { branchId: 'b1', id: HERO, equipped_items: [], inventory: [key.id] },
        },
      })
    })

    // Every reversal window that removes the turn must take the creates, so they come first.
    it('emits the creates first, then the metadata, then the writes that name them', async () => {
      seedFallbackTurn()
      const { events } = await runFallback(docksAndKey())
      expect(events.flatMap((e) => (e.type === 'delta_emitted' ? [e.action.kind] : []))).toEqual([
        'createEntity',
        'createEntity',
        'updateStoryEntryMetadata',
        'updateEntityLocationTracking',
        'updateEntityInventory',
      ])
    })

    // data-model.md → LocationState shape: the fallback reuses and places an unplaced namesake too.
    it('places a reused unplaced place right after the creates, before the metadata', async () => {
      const DOCKS_ROW = 'loc_00000000-0000-4000-8000-0000000000a3'
      seedFallbackTurn([
        ...fallbackWorld(),
        worldRow({
          id: DOCKS_ROW,
          kind: 'location',
          name: 'Smuggler Docks',
          state: { parent_location_id: null, unplaced: true },
        }),
      ])
      const { events } = await runFallback(docksAndKey())
      expect(events.flatMap((e) => (e.type === 'delta_emitted' ? [e.action.kind] : []))).toEqual([
        'createEntity',
        'placeLocation',
        'updateStoryEntryMetadata',
        'updateEntityLocationTracking',
        'updateEntityInventory',
      ])
      expect(events).toContainEqual({
        type: 'delta_emitted',
        action: {
          kind: 'placeLocation',
          source: 'per_turn_classifier',
          payload: {
            branchId: 'b1',
            id: DOCKS_ROW,
            placement: { kind: 'under', parentId: TOWN },
            proseEntryId: null,
          },
        },
      })
      expect(metadataPatch(events).currentLocationId).toBe(DOCKS_ROW)
    })

    // data-model.md → Disabled places: judged by the rows below the reply, the place the turn found.
    it('leaves a reused place unplaced when the story was in it before the reply', async () => {
      const DOCKS_ROW = 'loc_00000000-0000-4000-8000-0000000000a3'
      const world = fallbackWorld().map((e) =>
        e.id === TOWN ? { ...e, injectionMode: 'disabled' as const } : e,
      )
      seedFallbackTurn(
        [
          ...world,
          worldRow({
            id: DOCKS_ROW,
            kind: 'location',
            name: 'Smuggler Docks',
            state: { parent_location_id: null, unplaced: true },
          }),
        ],
        undefined,
        { ...SCENE, currentLocationId: DOCKS_ROW },
      )
      const { events } = await runFallback(docksAndKey())
      expect(
        events.flatMap((e) => (e.type === 'delta_emitted' ? [e.action.kind] : [])),
      ).not.toContain('placeLocation')
      expect(metadataPatch(events).stateReport?.newLocations).toEqual([
        expect.objectContaining({ outcome: 'reused', id: DOCKS_ROW, parentDropped: true }),
      ])
    })

    it('creates a place whose parent is "top" at the top level', async () => {
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [
            { handle: 'new:isle', name: 'Gull Isle', description: 'a bare rock', parent: 'top' },
          ],
          currentLocation: 'new:isle',
          worldTimeDelta: 30,
        }),
      )
      const [isle] = createdEntries(events)
      expect(isle?.state).toEqual({ parent_location_id: null })
      expect(metadataPatch(events).stateReport?.newLocations).toEqual([
        {
          handle: 'new:isle',
          name: 'Gull Isle',
          description: 'a bare rock',
          parent: 'top',
          outcome: 'created',
          id: isle?.id,
        },
      ])
    })

    // piggyback.md → Matching before creating: reuse goes by the map this prompt showed. Around
    // Saltmere, disabled but the scene's, the market hangs under it, so a top-level namesake is new.
    it('matches against the map built around the scene this prompt read', async () => {
      const disabledTown = worldRow({
        id: TOWN,
        kind: 'location',
        name: 'Saltmere',
        injectionMode: 'disabled',
      })
      seedFallbackTurn([fallbackWorld()[0]!, disabledTown, market('active')])
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [
            { handle: 'new:market', name: 'The Drowned Market', description: 'mud', parent: 'top' },
          ],
          currentLocation: 'new:market',
          worldTimeDelta: 30,
        }),
      )
      expect(createdEntries(events)).toEqual([
        expect.objectContaining({
          name: 'The Drowned Market',
          state: { parent_location_id: null },
        }),
      ])
    })

    it('flags a new place same-parent against a partial sibling, naming it', async () => {
      seedFallbackTurn([...fallbackWorld(), market('active')])
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [
            {
              handle: 'new:stalls',
              name: 'The Drowned Market Stalls',
              description: 'a row of stalls',
              parent: 'l1',
            },
          ],
          currentLocation: 'new:stalls',
          worldTimeDelta: 30,
        }),
      )
      expect(createdEntries(events)).toEqual([
        expect.objectContaining({
          name: 'The Drowned Market Stalls',
          nameCollisionFlag: 1,
          nameCollisionPartnerId: MARKET,
          nameCollisionReason: 'same-parent',
        }),
      ])
    })

    it('reuses a staged exact sibling and promotes it once', async () => {
      seedFallbackTurn([...fallbackWorld(), market('staged')])
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [
            {
              handle: 'new:market',
              name: 'the drowned market',
              description: 'mud and awnings',
              parent: 'l1',
            },
          ],
          currentLocation: 'new:market',
          worldTimeDelta: 30,
        }),
      )
      expect(createdEntries(events)).toEqual([])
      const patch = metadataPatch(events)
      expect(patch.currentLocationId).toBe(MARKET)
      expect(patch.stateReport?.newLocations).toEqual([
        {
          handle: 'new:market',
          name: 'the drowned market',
          description: 'mud and awnings',
          parent: TOWN,
          outcome: 'reused',
          id: MARKET,
        },
      ])
      expect(
        events.filter((e) => e.type === 'delta_emitted' && e.action.kind === 'promoteStagedEntity'),
      ).toEqual([
        {
          type: 'delta_emitted',
          action: {
            kind: 'promoteStagedEntity',
            source: 'per_turn_classifier',
            payload: { branchId: 'b1', id: MARKET, proseEntryId: null },
          },
        },
      ])
    })

    // The reused sibling only parents the current location, so only reusedIds can promote it.
    it('promotes a reused staged place that only parents the new current location', async () => {
      seedFallbackTurn([...fallbackWorld(), market('staged')])
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [
            { handle: 'new:market', name: 'the drowned market', description: 'mud', parent: 'l1' },
            {
              handle: 'new:annex',
              name: 'Net Loft',
              description: 'a loft of nets',
              parent: 'new:market',
            },
          ],
          currentLocation: 'new:annex',
          worldTimeDelta: 30,
        }),
      )
      const [annex] = createdEntries(events)
      expect(annex).toMatchObject({ name: 'Net Loft', state: { parent_location_id: MARKET } })
      expect(
        events.flatMap((e) =>
          e.type === 'delta_emitted' && e.action.kind === 'promoteStagedEntity'
            ? [e.action.payload.id]
            : [],
        ),
      ).toEqual([MARKET])
    })

    it("replaces a failed fold's dropped list with its own creates, per kind", async () => {
      seedFallbackTurn(fallbackWorld(), FOLD_REPORT)
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [DOCKS],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
        }),
        { intermediates: { piggybackOutcome: { attempted: true, succeeded: false } } },
      )
      expect(createdEntries(events).map((e) => e.name)).toEqual(['Smuggler Docks'])
      const report = metadataPatch(events).stateReport
      expect(report?.newLocations).toEqual([
        expect.objectContaining({ handle: 'new:docks', outcome: 'created' }),
      ])
      // This phase emitted no item, so the fold's dropped item stays on the record.
      expect(report?.newItems).toEqual(FOLD_REPORT.newItems)
      expect(report?.failedFields).toEqual(FOLD_REPORT.failedFields)
    })

    it("keeps a failed fold's dropped creates when the fallback emits none", async () => {
      seedFallbackTurn(fallbackWorld(), FOLD_REPORT)
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({ sceneEntities: ['c1'], worldTimeDelta: 30 }),
        { intermediates: { piggybackOutcome: { attempted: true, succeeded: false } } },
      )
      expect(createdEntries(events)).toEqual([])
      const report = metadataPatch(events).stateReport
      expect(report?.layer).toBe('per_turn_classifier')
      expect(report?.newLocations).toEqual(FOLD_REPORT.newLocations)
      expect(report?.newItems).toEqual(FOLD_REPORT.newItems)
    })

    // The report decides, not the outcome: a kind the fallback reports, even dropped, never keeps
    // the fold's list; malformed creates never reach that report.
    it("reports the fallback's own dropped creates rather than the fold's", async () => {
      seedFallbackTurn(fallbackWorld(), FOLD_REPORT)
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
        }),
        { intermediates: { piggybackOutcome: { attempted: true, succeeded: false } } },
      )
      expect(createdEntries(events)).toEqual([])
      const report = metadataPatch(events).stateReport
      expect(report?.newItems).toEqual([
        {
          handle: 'new:key',
          name: 'rusted key',
          description: 'an iron key',
          outcome: 'dropped',
        },
      ])
      expect(report?.newLocations).toEqual(FOLD_REPORT.newLocations)
    })

    it("keeps a failed fold's dropped items when the fallback's only item is malformed", async () => {
      seedFallbackTurn(fallbackWorld(), FOLD_REPORT)
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          worldTimeDelta: 30,
          newItems: [{ handle: 'key', name: 'rusted key', description: 'an iron key' }],
        }),
        { intermediates: { piggybackOutcome: { attempted: true, succeeded: false } } },
      )
      expect(metadataPatch(events).stateReport?.newItems).toEqual(FOLD_REPORT.newItems)
    })

    it('warns about malformed creates and creates nothing from them', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          worldTimeDelta: 30,
          newLocations: [
            { handle: 'new:', name: 'Nowhere', description: 'nothing' },
            { handle: 'new:blank', name: '  ', description: 'no name' },
          ],
          newItems: [{ handle: 'key', name: 'rusted key', description: 'an iron key' }],
        }),
        { log: logger },
      )
      expect(createdEntries(events)).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith('classifier.create_malformed', {
        entryId: 'entry-2',
        count: 3,
        layer: 'per_turn_classifier',
      })
    })

    // c1 is HERO and l1 is TOWN: neither is an item, nor is the new place.
    it.each([
      ["a new place's handle", 'new:docks'],
      ["an existing place's id", 'l1'],
      ["a character's id", 'c1'],
    ])('drops only a transfer naming %s as its item, with a warning', async (_label, ref) => {
      seedFallbackTurn()
      const log: Logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          ...docksAndKey(),
          transfers: {
            items: [
              { id: 'new:key', to: 'c1', slot: 'inventory' },
              { id: ref, to: 'c1', slot: 'inventory' },
            ],
            stackables: [{ key: 'gold', amount: 5, to: 'c1' }],
          },
        }),
        { log },
      )
      const [docks, key] = createdEntries(events)
      if (!docks || !key) throw new Error('expected a location create and an item create')
      expect(log.warn).toHaveBeenCalledWith('classifier.transfer_dropped', {
        entryId: 'entry-2',
        transfer: { id: ref, to: 'c1', slot: 'inventory', seq: 1 },
        detail: expect.stringContaining('not an item'),
      })
      const patch = metadataPatch(events)
      expect(patch.stateReport?.failedFields).toBeUndefined()
      expect(patch.stateReport?.transfers).toEqual({
        items: [{ id: key.id, to: HERO, slot: 'inventory' }],
        stackables: [{ key: 'gold', amount: 5, to: HERO }],
      })
      expect(events).toContainEqual({
        type: 'delta_emitted',
        action: {
          kind: 'updateEntityInventory',
          source: 'per_turn_classifier',
          payload: { branchId: 'b1', id: HERO, equipped_items: [], inventory: [key.id] },
        },
      })
      expect(events).toContainEqual({
        type: 'delta_emitted',
        action: {
          kind: 'updateEntityStackables',
          source: 'per_turn_classifier',
          payload: { branchId: 'b1', id: HERO, stackables: { gold: 5 } },
        },
      })
    })

    it('drops only the transfers with an unknown ref, with a warning, applying the rest', async () => {
      seedFallbackTurn()
      const log: Logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
      const unknownItem = { id: 'i9', to: 'c1', slot: 'inventory' as const }
      const unknownHolder = { key: 'silver', amount: 2, from: 'c9' }
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          ...docksAndKey(),
          transfers: {
            items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }, unknownItem],
            stackables: [{ key: 'gold', amount: 5, to: 'c1' }, unknownHolder],
          },
        }),
        { log },
      )
      const [, key] = createdEntries(events)
      if (!key) throw new Error('expected the item create')
      expect(log.warn).toHaveBeenCalledWith('classifier.transfer_dropped', {
        entryId: 'entry-2',
        transfer: { ...unknownItem, seq: 1 },
        detail: expect.stringContaining('i9'),
      })
      expect(log.warn).toHaveBeenCalledWith('classifier.transfer_dropped', {
        entryId: 'entry-2',
        transfer: unknownHolder,
        detail: expect.stringContaining('c9'),
      })
      const patch = metadataPatch(events)
      expect(patch.stateReport?.failedFields).toBeUndefined()
      expect(patch.stateReport?.transfers).toEqual({
        items: [{ id: key.id, to: HERO, slot: 'inventory' }],
        stackables: [{ key: 'gold', amount: 5, to: HERO }],
      })
    })

    it("rejects a new item's handle as the location when the item isn't kept", async () => {
      const log: Logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:docks', name: 'the Docks', description: 'a pier' }],
        }),
        { log },
      )
      expect(createdEntries(events)).toEqual([])
      const patch = metadataPatch(events)
      expect(patch.currentLocationId).toBe(TOWN)
      expect(patch.stateReport).toMatchObject({
        currentLocation: 'new:docks',
        currentLocationRejected: true,
        newItems: [expect.objectContaining({ handle: 'new:docks', outcome: 'dropped' })],
      })
      expect(log.warn).toHaveBeenCalledWith('classifier.current_location_rejected', {
        entryId: 'entry-2',
        currentLocation: 'new:docks',
        kind: null,
        status: null,
      })
    })

    // piggyback.md → A bad ref in the two writers: a retired place's id resolves but is rejected.
    it('rejects a retired place as the location and keeps the previous one', async () => {
      seedFallbackTurn([...fallbackWorld(), market('retired')])
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          currentLocation: 'l2',
          worldTimeDelta: 30,
        }),
      )
      const patch = metadataPatch(events)
      expect(patch.currentLocationId).toBe(TOWN)
      expect(patch.stateReport).toMatchObject({
        currentLocation: MARKET,
        currentLocationRejected: true,
      })
    })

    it("rejects a new item's handle as the location when the item is kept", async () => {
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:docks', name: 'the Docks', description: 'a pier' }],
          transfers: { items: [{ id: 'new:docks', to: 'c1', slot: 'inventory' }], stackables: [] },
        }),
      )
      const [docks] = createdEntries(events)
      if (!docks) throw new Error('expected the item create')
      const patch = metadataPatch(events)
      expect(patch.currentLocationId).toBe(TOWN)
      expect(patch.stateReport).toMatchObject({
        currentLocation: docks.id,
        currentLocationRejected: true,
      })
    })

    it("logs a dropped create through the phase's logger", async () => {
      seedFallbackTurn()
      const log: Logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
      await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
        }),
        { log },
      )
      expect(log.debug).toHaveBeenCalledWith('classifier.create_dropped', {
        kind: 'item',
        handle: 'new:key',
        name: 'rusted key',
      })
    })

    // As on the tagged path, a description-less create must not fail the call and drop the rest.
    it('creates a row with no description and still applies the rest of the reply', async () => {
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [{ handle: 'new:docks', name: 'Smuggler Docks', parent: 'l1' }],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:key', name: 'rusted key' }],
          transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
          summary: 'Aria reached the docks.',
        }),
      )
      const [docks, key] = createdEntries(events)
      if (!docks || !key) throw new Error('expected a location create and an item create')
      expect(docks).toMatchObject({ name: 'Smuggler Docks', description: null })
      expect(key).toMatchObject({ name: 'rusted key', description: null })
      const patch = metadataPatch(events)
      expect(patch).toMatchObject({
        sceneEntities: [HERO],
        currentLocationId: docks.id,
        worldTime: 130,
        summary: 'Aria reached the docks.',
      })
      expect(patch.stateReport?.newLocations).toEqual([
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: '',
          parent: TOWN,
          outcome: 'created',
          id: docks.id,
        },
      ])
      expect(patch.stateReport?.newItems).toEqual([
        { handle: 'new:key', name: 'rusted key', description: '', outcome: 'created', id: key.id },
      ])
    })

    // JSON's way to say "none"; a schema that rejected it would fail the whole reply.
    it('reads a null parent as none, leaving the place unplaced', async () => {
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [
            { handle: 'new:isle', name: 'Gull Isle', description: 'a bare rock', parent: null },
          ],
          currentLocation: 'new:isle',
          worldTimeDelta: 30,
          summary: 'Aria rowed out to Gull Isle.',
        }),
      )
      const [isle] = createdEntries(events)
      if (!isle) throw new Error('expected a location create')
      expect(isle).toMatchObject({ name: 'Gull Isle' })
      expect(isle.state).toEqual({ parent_location_id: null, unplaced: true })
      const patch = metadataPatch(events)
      expect(patch).toMatchObject({
        sceneEntities: [HERO],
        currentLocationId: isle.id,
        worldTime: 130,
        summary: 'Aria rowed out to Gull Isle.',
      })
      expect(patch.stateReport?.newLocations).toEqual([
        {
          handle: 'new:isle',
          name: 'Gull Isle',
          description: 'a bare rock',
          outcome: 'created',
          id: isle.id,
        },
      ])
    })

    it('reads a null description as none, creating the row without one', async () => {
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [{ ...DOCKS, description: null }],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:key', name: 'rusted key', description: null }],
          transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
        }),
      )
      const [docks, key] = createdEntries(events)
      if (!docks || !key) throw new Error('expected a location create and an item create')
      expect(docks).toMatchObject({ name: 'Smuggler Docks', description: null })
      expect(key).toMatchObject({ name: 'rusted key', description: null })
      expect(metadataPatch(events)).toMatchObject({ currentLocationId: docks.id, worldTime: 130 })
    })

    it('drops and counts a create with a null handle or name, applying the rest', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [DOCKS, { handle: null, name: 'Gull Isle', description: 'a bare rock' }],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:key', name: null, description: 'an iron key' }],
          summary: 'Aria reached the docks.',
        }),
        { log: logger },
      )
      expect(warnSpy).toHaveBeenCalledWith('classifier.create_malformed', {
        entryId: 'entry-2',
        count: 2,
        layer: 'per_turn_classifier',
      })
      const [docks, ...others] = createdEntries(events)
      expect(docks).toMatchObject({ name: 'Smuggler Docks' })
      expect(others).toEqual([])
      expect(metadataPatch(events)).toMatchObject({
        sceneEntities: [HERO],
        currentLocationId: docks?.id,
        worldTime: 130,
        summary: 'Aria reached the docks.',
      })
    })

    // A schema rejecting a non-list would fail the whole reply, scene and summary included.
    it.each([
      ['newLocations', null],
      ['newItems', null],
      ['newLocations', 'none'],
      ['newItems', 0],
    ] as const)('reads a %s of %j as none, applying the rest', async (field, list) => {
      const warnSpy = vi.spyOn(logger, 'warn')
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          [field]: list,
          currentLocation: 'l1',
          worldTimeDelta: 30,
          summary: 'Aria waited at the tide line.',
        }),
        { log: logger },
      )
      // None, not a create dropped as malformed.
      expect(warnSpy).not.toHaveBeenCalledWith('classifier.create_malformed', expect.anything())
      expect(createdEntries(events)).toEqual([])
      const patch = metadataPatch(events)
      expect(patch).toMatchObject({
        sceneEntities: [HERO],
        currentLocationId: TOWN,
        worldTime: 130,
        summary: 'Aria waited at the tide line.',
      })
      expect(patch.stateReport).not.toHaveProperty(field)
    })

    // A create sent bare rather than in a list goes through the per-create rules all the same.
    it('reads a lone create object as a list of one, keeping it when valid', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: { handle: null, name: 'Gull Isle' },
          worldTimeDelta: 30,
          newItems: { handle: 'new:key', name: 'rusted key', description: 'an iron key' },
          transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
        }),
        { log: logger },
      )
      expect(warnSpy).toHaveBeenCalledWith('classifier.create_malformed', {
        entryId: 'entry-2',
        count: 1,
        layer: 'per_turn_classifier',
      })
      const [key, ...others] = createdEntries(events)
      expect(key).toMatchObject({ kind: 'item', name: 'rusted key', description: 'an iron key' })
      expect(others).toEqual([])
      expect(metadataPatch(events).stateReport?.newItems).toEqual([
        {
          handle: 'new:key',
          name: 'rusted key',
          description: 'an iron key',
          outcome: 'created',
          id: key?.id,
        },
      ])
    })

    it('drops and counts a create that is not an object, creating the rest', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: ['the docks', DOCKS, ['new:isle']],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
          newItems: [null, { handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
          transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
        }),
        { log: logger },
      )
      expect(warnSpy).toHaveBeenCalledWith('classifier.create_malformed', {
        entryId: 'entry-2',
        count: 3,
        layer: 'per_turn_classifier',
      })
      expect(createdEntries(events).map((e) => [e.kind, e.name])).toEqual([
        ['location', 'Smuggler Docks'],
        ['item', 'rusted key'],
      ])
    })

    it("counts an item list's null create as the only malformed one", async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          worldTimeDelta: 30,
          newItems: [null, { handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
          transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
        }),
        { log: logger },
      )
      expect(warnSpy).toHaveBeenCalledWith('classifier.create_malformed', {
        entryId: 'entry-2',
        count: 1,
        layer: 'per_turn_classifier',
      })
      const [key, ...others] = createdEntries(events)
      expect(key).toMatchObject({ kind: 'item', name: 'rusted key' })
      expect(others).toEqual([])
      expect(metadataPatch(events).stateReport?.newItems).toEqual([
        {
          handle: 'new:key',
          name: 'rusted key',
          description: 'an iron key',
          outcome: 'created',
          id: key?.id,
        },
      ])
    })

    it('does not warn when every create is well formed', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      seedFallbackTurn()
      await runFallback(docksAndKey(), { log: logger })
      expect(warnSpy).not.toHaveBeenCalledWith('classifier.create_malformed', expect.anything())
    })

    // Substituting before trimming would fail currentLocation as undeclared for a padded handle.
    it('normalizes a create before substituting the handles that name it', async () => {
      seedFallbackTurn()
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          newLocations: [{ ...DOCKS, handle: ' [new:docks] ', name: '  Smuggler Docks  ' }],
          currentLocation: 'new:docks',
          worldTimeDelta: 30,
        }),
      )
      const [docks] = createdEntries(events)
      expect(docks).toMatchObject({ name: 'Smuggler Docks' })
      const report = metadataPatch(events).stateReport
      expect(report?.failedFields).toBeUndefined()
      expect(report?.currentLocation).toBe(docks?.id)
    })

    it("keeps a failed fold's dropped locations when the fallback creates only an item", async () => {
      seedFallbackTurn(fallbackWorld(), FOLD_REPORT)
      const { events } = await runFallback(
        fallbackClassifierSchema.parse({
          sceneEntities: ['c1'],
          worldTimeDelta: 30,
          newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
          transfers: { items: [{ id: 'new:key', to: 'c1', slot: 'inventory' }], stackables: [] },
        }),
        { intermediates: { piggybackOutcome: { attempted: true, succeeded: false } } },
      )
      const [key] = createdEntries(events)
      expect(key).toMatchObject({ kind: 'item', name: 'rusted key' })
      const report = metadataPatch(events).stateReport
      expect(report?.newItems).toEqual([
        expect.objectContaining({ outcome: 'created', id: key?.id }),
      ])
      expect(report?.newLocations).toEqual(FOLD_REPORT.newLocations)
    })

    it('discards its writes when a cancel lands during the item match', async () => {
      seedFallbackTurn([
        ...fallbackWorld(),
        worldRow({ id: OLD_KEY, kind: 'item', name: 'rusted key', description: 'an iron key' }),
      ])
      const controller = new AbortController()
      configureClassifierEmbedder(async (texts) => {
        controller.abort()
        return { vectors: texts.map(() => new Float32Array([1, 0])), dim: 2 }
      })
      const { events, result } = await runFallback(docksAndKey(), { signal: controller.signal })
      expect(result).toEqual({ status: 'aborted' })
      expect(events).toEqual([])
    })

    // piggyback.md → Fallback classifier context: conditions and drops under the tags' rules.
    describe('conditions and drops', () => {
      const keyHeld = () =>
        worldRow({
          id: HERO,
          kind: 'character',
          name: 'Aria',
          state: {
            ...emptyEntityState('character'),
            current_location_id: TOWN,
            inventory: [OLD_KEY],
          },
        })
      const keyRow = () =>
        worldRow({
          id: OLD_KEY,
          kind: 'item',
          name: 'rusted key',
          description: 'an iron key',
          state: { at_location_id: null },
        })
      // c1 HERO, l1 TOWN, l2 MARKET, i1 OLD_KEY: allocated in this order.
      const idMapWithKey = () => {
        const idMap = new IdBiMap()
        for (const id of [HERO, TOWN, MARKET, OLD_KEY]) idMap.allocate(id)
        return idMap
      }
      const payloads = (
        events: readonly PhaseEmittedEvent[],
        kind:
          | 'updateEntityCondition'
          | 'updateEntityInventory'
          | 'updateItemPosition'
          | 'updateEntityStackables'
          | 'updateEntityVisualState',
      ) =>
        events.flatMap((e) =>
          e.type === 'delta_emitted' && e.action.kind === kind ? [e.action.payload] : [],
        )

      // data-model.md → Authorship contract: the key is held in the scene; the town, with no
      // retrieval behind the turn, is on the map by name only.
      it('writes a condition only for a row its prompt showed with its state', async () => {
        seedFallbackTurn([
          keyHeld(),
          worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
          keyRow(),
        ])
        const log: Logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
        const { events } = await runFallback(
          fallbackClassifierSchema.parse({
            sceneEntities: ['c1'],
            worldTimeDelta: 0,
            conditions: [
              { id: 'i1', text: 'bent at the bit' },
              { id: 'l1', text: 'flooded to the knee' },
            ],
          }),
          { log, intermediates: { idMap: idMapWithKey() } },
        )
        expect(payloads(events, 'updateEntityCondition')).toEqual([
          { branchId: 'b1', id: OLD_KEY, condition: 'bent at the bit' },
        ])
        expect(log.warn).toHaveBeenCalledWith('classifier.condition_unseen', {
          entryId: 'entry-2',
          source: 'per_turn_classifier',
          entityId: TOWN,
          kind: 'location',
          shown: false,
        })
        expect(metadataPatch(events).stateReport?.conditions).toEqual([
          { id: OLD_KEY, text: 'bent at the bit' },
          { id: TOWN, text: 'flooded to the knee', rejected: true },
        ])
      })

      it('marks a blank condition refused on the report and writes nothing', async () => {
        seedFallbackTurn([
          keyHeld(),
          worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
          keyRow(),
        ])
        const { events } = await runFallback(
          fallbackClassifierSchema.parse({
            sceneEntities: ['c1'],
            worldTimeDelta: 0,
            conditions: [{ id: 'i1', text: '  ' }],
          }),
          { intermediates: { idMap: idMapWithKey() } },
        )
        expect(payloads(events, 'updateEntityCondition')).toEqual([])
        expect(metadataPatch(events).stateReport?.conditions).toEqual([
          { id: OLD_KEY, text: '  ', rejected: true },
        ])
      })

      it("writes the current location's condition once the floor seats it", async () => {
        seedFallbackTurn()
        const town: EntityRow = {
          id: TOWN,
          kind: 'location',
          status: 'active',
          injectionMode: 'auto',
          name: 'Saltmere',
          description: null,
        }
        const { events } = await runFallback(
          fallbackClassifierSchema.parse({
            sceneEntities: ['c1'],
            worldTimeDelta: 0,
            conditions: [{ id: 'l1', text: 'flooded to the knee' }],
          }),
          {
            intermediates: {
              [RETRIEVAL_INTERMEDIATE_KEY]: retrievalSuccess({ floor: { currentLocation: town } }),
            },
          },
        )
        expect(payloads(events, 'updateEntityCondition')).toEqual([
          { branchId: 'b1', id: TOWN, condition: 'flooded to the knee' },
        ])
      })

      // The JSON's two lists carry no order between them: drops apply after every item move, not
      // interleaved by index (the lamp moves first, the key second).
      it('puts the key down after all the moves, so it lies where the scene is', async () => {
        const OLD_LAMP = 'item_00000000-0000-4000-8000-0000000000b2'
        seedFallbackTurn([
          keyHeld(),
          worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
          keyRow(),
          worldRow({
            id: OLD_LAMP,
            kind: 'item',
            name: 'tin lamp',
            description: 'a dented lamp',
            state: { at_location_id: null },
          }),
        ])
        const idMap = idMapWithKey()
        idMap.allocate(OLD_LAMP) // i2
        const { events } = await runFallback(
          fallbackClassifierSchema.parse({
            sceneEntities: ['c1'],
            worldTimeDelta: 0,
            transfers: {
              items: [
                { id: 'i2', to: 'c1', slot: 'inventory' },
                { id: 'i1', to: 'c1', slot: 'equipped_items' },
              ],
              stackables: [],
              drops: [{ id: 'i1', from: 'c1' }],
            },
          }),
          { intermediates: { idMap } },
        )
        expect(payloads(events, 'updateEntityInventory')).toEqual([
          { branchId: 'b1', id: HERO, equipped_items: [], inventory: [OLD_LAMP] },
        ])
        expect(payloads(events, 'updateItemPosition')).toEqual([
          { branchId: 'b1', id: OLD_KEY, atLocationId: TOWN },
        ])
      })

      it('reports its conditions and where its drops landed', async () => {
        seedFallbackTurn([
          keyHeld(),
          worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }),
          keyRow(),
        ])
        const { events } = await runFallback(
          fallbackClassifierSchema.parse({
            sceneEntities: ['c1'],
            worldTimeDelta: 0,
            conditions: [{ id: 'i1', text: 'bent at the bit' }],
            transfers: { items: [], stackables: [], drops: [{ id: 'i1', from: 'c1' }] },
          }),
          { intermediates: { idMap: idMapWithKey() } },
        )
        const report = metadataPatch(events).stateReport
        expect(report?.conditions).toEqual([{ id: OLD_KEY, text: 'bent at the bit' }])
        expect(report?.transfers).toEqual({
          items: [],
          stackables: [],
          drops: [{ id: OLD_KEY, from: HERO, at: TOWN }],
        })
      })

      // The fold applied these before its parse failed: a reply naming neither keeps its record.
      it("keeps the fold's conditions and transfers when the reply reports neither", async () => {
        const foldReport: NonNullable<EntryMetadata['stateReport']> = {
          layer: 'piggyback_tagged_block',
          conditions: [{ id: TOWN, text: 'flooded to the knee' }],
          transfers: { items: [{ id: OLD_KEY, to: HERO, slot: 'inventory' }], stackables: [] },
          failedFields: [{ field: 'sceneEntities', detail: 'unresolvable placeholder' }],
        }
        seedFallbackTurn(fallbackWorld(), foldReport)
        const { events } = await runFallback(
          fallbackClassifierSchema.parse({ sceneEntities: ['c1'], worldTimeDelta: 0 }),
          { intermediates: { piggybackOutcome: { attempted: true, succeeded: false } } },
        )
        const report = metadataPatch(events).stateReport
        expect(report?.conditions).toEqual(foldReport.conditions)
        expect(report?.transfers).toEqual(foldReport.transfers)
      })

      // An empty list reports nothing, as a field left out does: the fold's rows stay written.
      it("keeps the fold's record when the reply reports its lists empty", async () => {
        const foldReport: NonNullable<EntryMetadata['stateReport']> = {
          layer: 'piggyback_tagged_block',
          visualChanges: [{ id: HERO, type: 'attire', text: 'torn cloak' }],
          conditions: [
            { id: TOWN, text: 'flooded to the knee' },
            { id: MARKET, text: 'burned to the waterline', rejected: true },
          ],
          transfers: { items: [{ id: OLD_KEY, to: HERO, slot: 'inventory' }], stackables: [] },
          failedFields: [{ field: 'sceneEntities', detail: 'unresolvable placeholder' }],
        }
        seedFallbackTurn(fallbackWorld(), foldReport)
        const { events } = await runFallback(
          fallbackClassifierSchema.parse({
            sceneEntities: ['c1'],
            worldTimeDelta: 0,
            visualChanges: [],
            conditions: [],
            transfers: { items: [], stackables: [], drops: [] },
          }),
          { intermediates: { piggybackOutcome: { attempted: true, succeeded: false } } },
        )
        const report = metadataPatch(events).stateReport
        expect(report?.visualChanges).toEqual(foldReport.visualChanges)
        expect(report?.conditions).toEqual(foldReport.conditions)
        expect(report?.transfers).toEqual(foldReport.transfers)
      })

      // Nothing of the reply's field applied counts as absent too (the town is name-only, the key
      // lies away from the scene): the fold's record stays.
      describe('a reply field with nothing applied', () => {
        const LAMP = 'item_00000000-0000-4000-8000-0000000000b3'
        const foldReport: NonNullable<EntryMetadata['stateReport']> = {
          layer: 'piggyback_tagged_block',
          conditions: [{ id: TOWN, text: 'flooded to the knee' }],
          transfers: { items: [{ id: LAMP, to: HERO, slot: 'inventory' }], stackables: [] },
          failedFields: [{ field: 'sceneEntities', detail: 'unresolvable placeholder' }],
        }
        const fallbackAfterFold = (reply: Record<string, unknown>) =>
          runFallback(
            fallbackClassifierSchema.parse({ sceneEntities: ['c1'], worldTimeDelta: 0, ...reply }),
            {
              intermediates: {
                idMap: idMapWithKey(),
                piggybackOutcome: { attempted: true, succeeded: false },
              },
            },
          )

        it("keeps the fold's conditions when every condition is rejected", async () => {
          seedFallbackTurn(
            [keyHeld(), worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }), keyRow()],
            foldReport,
          )
          const { events } = await fallbackAfterFold({
            conditions: [{ id: 'l1', text: 'burned to the waterline' }],
          })
          expect(payloads(events, 'updateEntityCondition')).toEqual([])
          expect(metadataPatch(events).stateReport?.conditions).toEqual(foldReport.conditions)
        })

        it('reports its own conditions when one of them is written', async () => {
          seedFallbackTurn(
            [keyHeld(), worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }), keyRow()],
            foldReport,
          )
          const { events } = await fallbackAfterFold({
            conditions: [
              { id: 'i1', text: 'bent at the bit' },
              { id: 'l1', text: 'burned to the waterline' },
            ],
          })
          expect(metadataPatch(events).stateReport?.conditions).toEqual([
            { id: OLD_KEY, text: 'bent at the bit' },
            { id: TOWN, text: 'burned to the waterline', rejected: true },
          ])
        })

        it("keeps the fold's transfers when every drop is refused", async () => {
          seedFallbackTurn(
            [
              ...fallbackWorld(),
              market('active'),
              worldRow({ ...keyRow(), state: { at_location_id: MARKET } }),
            ],
            foldReport,
          )
          const { events } = await fallbackAfterFold({
            transfers: { items: [], stackables: [], drops: [{ id: 'i1' }] },
          })
          expect(payloads(events, 'updateItemPosition')).toEqual([])
          expect(metadataPatch(events).stateReport?.transfers).toEqual(foldReport.transfers)
        })

        // A holder isn't kind-checked, so these resolve; naming no character, they write nothing.
        it.each([
          [
            'an item moved to a place',
            { items: [{ id: 'i1', to: 'l1', slot: 'inventory' }], stackables: [], drops: [] },
          ],
          [
            'a stackable paid to a place',
            { items: [], stackables: [{ key: 'gold', amount: 5, to: 'l1' }], drops: [] },
          ],
        ])("keeps the fold's transfers when its only transfer is %s", async (_label, transfers) => {
          seedFallbackTurn(
            [keyHeld(), worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }), keyRow()],
            foldReport,
          )
          const { events } = await fallbackAfterFold({ transfers })
          expect(payloads(events, 'updateEntityInventory')).toEqual([])
          expect(payloads(events, 'updateEntityStackables')).toEqual([])
          expect(metadataPatch(events).stateReport?.transfers).toEqual(foldReport.transfers)
        })

        const visualFold: NonNullable<EntryMetadata['stateReport']> = {
          ...foldReport,
          visualChanges: [{ id: HERO, type: 'attire', text: 'a torn cloak' }],
        }

        it("keeps the fold's visual changes when its only one names a place", async () => {
          seedFallbackTurn(fallbackWorld(), visualFold)
          const { events } = await fallbackAfterFold({
            visualChanges: [{ id: 'l1', type: 'attire', text: 'weathered stonework' }],
          })
          expect(payloads(events, 'updateEntityVisualState')).toEqual([])
          expect(metadataPatch(events).stateReport?.visualChanges).toEqual(visualFold.visualChanges)
        })

        it('reports its own visual changes when one of them is written', async () => {
          seedFallbackTurn(fallbackWorld(), visualFold)
          const visualChanges = [
            { id: 'l1', type: 'attire', text: 'weathered stonework' },
            { id: 'c1', type: 'hair', text: 'shorn short' },
          ]
          const { events } = await fallbackAfterFold({ visualChanges })
          expect(metadataPatch(events).stateReport?.visualChanges).toEqual([
            { id: TOWN, type: 'attire', text: 'weathered stonework' },
            { id: HERO, type: 'hair', text: 'shorn short' },
          ])
        })

        // Each part of the transfers check on its own: a move, a stackable or an applied drop.
        it.each([
          [
            'an item move',
            { items: [{ id: 'i1', to: 'c1', slot: 'equipped_items' }], stackables: [], drops: [] },
            { items: [{ id: OLD_KEY, to: HERO, slot: 'equipped_items' }], stackables: [] },
          ],
          [
            'a stackable',
            { items: [], stackables: [{ key: 'gold', amount: 5, to: 'c1' }], drops: [] },
            { items: [], stackables: [{ key: 'gold', amount: 5, to: HERO }] },
          ],
          [
            'an applied drop',
            { items: [], stackables: [], drops: [{ id: 'i1', from: 'c1' }] },
            { items: [], stackables: [], drops: [{ id: OLD_KEY, from: HERO, at: TOWN }] },
          ],
        ])('reports its own transfers when it has %s', async (_label, transfers, reported) => {
          seedFallbackTurn(
            [keyHeld(), worldRow({ id: TOWN, kind: 'location', name: 'Saltmere' }), keyRow()],
            foldReport,
          )
          const { events } = await fallbackAfterFold({ transfers })
          expect(metadataPatch(events).stateReport?.transfers).toEqual(reported)
        })
      })
    })
  })

  describe('fallbackClassifierSchema', () => {
    // Scoped to the exact node, not `toContain` over the blob. '[]' (not 'items') steps into
    // the array-element schema, since 'items' is itself a real property name on transfers.
    function schemaNode(schema: unknown, path: readonly string[]): Record<string, unknown> {
      let node: unknown = schema
      for (const key of path) {
        if (typeof node !== 'object' || node === null) return {}
        if (key === '[]') {
          node = (node as { items?: unknown }).items
          continue
        }
        node = (node as { properties?: Record<string, unknown> }).properties?.[key]
      }
      return typeof node === 'object' && node !== null ? (node as Record<string, unknown>) : {}
    }

    function fieldDescription(schema: unknown, path: readonly string[]): string | undefined {
      const { description } = schemaNode(schema, path)
      return typeof description === 'string' ? description : undefined
    }

    it('lists newLocations before currentLocation and newItems before transfers', () => {
      const order = Object.keys(z.toJSONSchema(fallbackClassifierSchema).properties ?? {})
      expect(order.indexOf('newLocations')).toBeLessThan(order.indexOf('currentLocation'))
      expect(order.indexOf('newItems')).toBeLessThan(order.indexOf('transfers'))
    })

    // A field with no describe is one the model never fills well; parity means the
    // fallback states it too (state-emission.ts; piggyback.md → Fallback classifier context).
    it.each([
      ['sceneEntities', ['sceneEntities'], 'present in this scene'],
      ['sceneEntities handles', ['sceneEntities'], 'exact handle it declares'],
      [
        'newLocations[].handle scope',
        ['newLocations', '[]', 'handle'],
        "another new place's parent",
      ],
      ['newItems[].handle scope', ['newItems', '[]', 'handle'], 'only in transfers.items[].id'],
      ['currentLocation', ['currentLocation'], 'place this scene happens at'],
      ['currentLocation with no Places block', ['currentLocation'], 'when Places lists it'],
      ['visualChanges[].text', ['visualChanges', '[]', 'text'], 'in about 60 words'],
      [
        'transfers.stackables[].key',
        ['transfers', 'stackables', '[]', 'key'],
        "exactly as the holder's Stackables line shows it",
      ],
      [
        'transfers.stackables[].amount',
        ['transfers', 'stackables', '[]', 'amount'],
        'not the resulting total',
      ],
      ['transfers.items[].to', ['transfers', 'items', '[]', 'to'], 'no other party'],
      ['transfers.items[].from', ['transfers', 'items', '[]', 'from'], 'no other party'],
      ['transfers.stackables[].to', ['transfers', 'stackables', '[]', 'to'], 'no other party'],
      ['transfers.stackables[].from', ['transfers', 'stackables', '[]', 'from'], 'no other party'],
      ['newLocations', ['newLocations'], 'kept only as currentLocation'],
      ['newLocations[].handle', ['newLocations', '[]', 'handle'], 'starting with "new:"'],
      [
        'newLocations[].parent',
        ['newLocations', '[]', 'parent'],
        'handle of another location in newLocations',
      ],
      [
        'newLocations[].parent with no Places block',
        ['newLocations', '[]', 'parent'],
        'when Places lists it',
      ],
      [
        'newLocations[].parent top',
        ['newLocations', '[]', 'parent'],
        '"top" only when nothing in Places could contain it',
      ],
      [
        'newItems',
        ['newItems'],
        'the last transfers.items entry naming it gives it to a character',
      ],
      ['newItems[].handle', ['newItems', '[]', 'handle'], 'starting with "new:"'],
      [
        'currentLocation for a new place',
        ['currentLocation'],
        'handle of a location in newLocations',
      ],
      ['transfers.items[].id', ['transfers', 'items', '[]', 'id'], 'handle of an item in newItems'],
      ['conditions', ['conditions'], 'shown above with its state'],
      ['conditions[].text', ['conditions', '[]', 'text'], 'replaces the stored condition whole'],
      [
        'conditions[].text limit',
        ['conditions', '[]', 'text'],
        'in a few words, never more than about 60',
      ],
      [
        'conditions[].text keeps what applies',
        ['conditions', '[]', 'text'],
        'keep what still applies, drop what no longer does, in a few words',
      ],
      ['transfers.drops', ['transfers', 'drops'], 'where the scene is'],
      ['transfers.drops end state', ['transfers', 'drops'], 'still lying there when the turn ends'],
      ['transfers.drops picked up again', ['transfers', 'drops'], 'An item picked up again'],
      [
        'newLocations[].condition',
        ['newLocations', '[]', 'condition'],
        'only when the turn shows one',
      ],
      ['newItems[].condition', ['newItems', '[]', 'condition'], 'only when the turn shows one'],
    ] as const)('describes %s', (_field, path, marker) => {
      const jsonSchema = z.toJSONSchema(fallbackClassifierSchema)
      expect(fieldDescription(jsonSchema, path)).toContain(marker)
    })

    // Null handle/name parses as '' to be dropped; the model is still asked for both, no default.
    it.each(['newLocations', 'newItems'] as const)(
      'asks for a %s handle and name as required strings',
      (field) => {
        const create = schemaNode(z.toJSONSchema(fallbackClassifierSchema), [field, '[]'])
        expect(create.required).toEqual(['handle', 'name'])
        for (const key of ['handle', 'name']) {
          const property = schemaNode(create, [key])
          expect(property.type).toBe('string')
          expect(property).not.toHaveProperty('default')
        }
      },
    )

    // The describes have to survive z.toJSONSchema — that is the only path by which
    // they reach the provider, and it throws on a transform.
    it('serialises to JSON schema without throwing', () => {
      expect(() => z.toJSONSchema(fallbackClassifierSchema)).not.toThrow()
      expect(() => z.toJSONSchema(fallbackClassifierWithSuggestionsSchema)).not.toThrow()
    })

    it('describes the summary field so the description survives into the emitted JSON schema', () => {
      const jsonSchema = z.toJSONSchema(fallbackClassifierSchema)
      const summary = jsonSchema.properties?.summary

      expect(typeof summary === 'object' ? summary.description : undefined).toBeTruthy()
    })

    it('describes the retrievalQueries field so the description survives into the emitted JSON schema', () => {
      const jsonSchema = z.toJSONSchema(fallbackClassifierSchema)
      const retrievalQueries = jsonSchema.properties?.retrievalQueries

      expect(
        typeof retrievalQueries === 'object' ? retrievalQueries.description : undefined,
      ).toBeTruthy()
    })

    // Optional or defaulted, so a canned mock reply without them stays valid.
    it('defaults the drops and leaves conditions out of a reply that gives none', () => {
      const parsed = fallbackClassifierSchema.parse({
        sceneEntities: [],
        worldTimeDelta: 0,
        transfers: { items: [], stackables: [] },
        newLocations: [{ handle: 'new:a', name: 'A' }],
        newItems: [{ handle: 'new:k', name: 'key' }],
      })
      expect(parsed.transfers?.drops).toEqual([])
      expect(parsed.conditions).toBeUndefined()
      expect(parsed.newLocations?.[0]?.condition).toBeUndefined()
      expect(parsed.newItems?.[0]?.condition).toBeUndefined()
    })

    it('keeps the conditions, the drops and the create conditions a reply gives', () => {
      const parsed = fallbackClassifierSchema.parse({
        sceneEntities: [],
        worldTimeDelta: 0,
        conditions: [{ id: 'l1', text: 'flooded to the knee' }],
        transfers: { items: [], stackables: [], drops: [{ id: 'i1', from: 'c1' }] },
        newLocations: [{ handle: 'new:a', name: 'A', condition: 'scorched' }],
        newItems: [{ handle: 'new:k', name: 'key', condition: 'bent' }],
      })
      expect(parsed.conditions).toEqual([{ id: 'l1', text: 'flooded to the knee' }])
      expect(parsed.transfers?.drops).toEqual([{ id: 'i1', from: 'c1' }])
      expect(parsed.newLocations?.[0]?.condition).toBe('scorched')
      expect(parsed.newItems?.[0]?.condition).toBe('bent')
    })

    // A failed parse costs the turn its scene, place, time and summary: one bad value drops alone.
    describe('a bad condition or drop', () => {
      const parse = (reply: Record<string, unknown>) =>
        fallbackClassifierSchema.parse({ sceneEntities: ['c1'], worldTimeDelta: 5, ...reply })
      const withDrops = (drops: unknown) =>
        parse({ transfers: { items: [], stackables: [], drops } })

      it('reads null conditions as none, keeping the rest of the reply', () => {
        const parsed = parse({ conditions: null, summary: 'Aria waits.' })
        expect(parsed.conditions).toBeUndefined()
        expect(parsed.worldTimeDelta).toBe(5)
        expect(parsed.summary).toBe('Aria waits.')
      })

      it('drops a condition it cannot read and keeps the others', () => {
        const parsed = parse({
          conditions: [
            { id: 'i1' },
            { id: 'i2', text: null },
            'scorched',
            { id: null, text: 'bent' },
            { id: 'l1', text: 'flooded to the knee' },
          ],
        })
        expect(parsed.conditions).toEqual([{ id: 'l1', text: 'flooded to the knee' }])
      })

      it('reads a lone condition as a list of one, as a lone create reads', () => {
        expect(parse({ conditions: { id: 'l1', text: 'flooded' } }).conditions).toEqual([
          { id: 'l1', text: 'flooded' },
        ])
      })

      it('reads null drops as none', () => {
        expect(withDrops(null).transfers?.drops).toEqual([])
      })

      it('drops a drop it cannot read and keeps the others', () => {
        expect(
          withDrops(['i1', { from: 'c1' }, { id: 7 }, { id: 'i2', from: 'c1' }]).transfers?.drops,
        ).toEqual([{ id: 'i2', from: 'c1' }])
      })

      it('reads a null holder as none, keeping the drop', () => {
        expect(withDrops([{ id: 'i1', from: null }]).transfers?.drops).toEqual([{ id: 'i1' }])
      })

      // piggyback.md → Trailing block format: put down somewhere else than the scene stays prose.
      it('drops a drop that names a place, as the tags do', () => {
        expect(
          withDrops([
            { id: 'i1', from: 'c1', to: 'l2' },
            { id: 'i2', to: null },
            { id: 'i3', to: ' ' },
          ]).transfers?.drops,
        ).toEqual([{ id: 'i2' }, { id: 'i3' }])
      })

      it('reads a lone drop as a list of one', () => {
        expect(withDrops({ id: 'i1', from: 'c1' }).transfers?.drops).toEqual([
          { id: 'i1', from: 'c1' },
        ])
      })

      // The tolerance is the parse's alone: the model is still asked for the full shape.
      it("still asks for a condition's id and text and a drop's id", () => {
        const jsonSchema = z.toJSONSchema(fallbackClassifierSchema)
        expect(schemaNode(jsonSchema, ['conditions', '[]']).required).toEqual(['id', 'text'])
        expect(schemaNode(jsonSchema, ['transfers', 'drops', '[]']).required).toEqual(['id'])
        expect(schemaNode(jsonSchema, ['transfers', 'drops']).default).toEqual([])
      })
    })

    // retrieval.md → Q4: emission is malformed-tolerant — raising here costs a full extra
    // provider call and takes the mandatory summary field down with an over-long hint too.
    it('drops an over-long retrievalQueries without failing the sibling fields', () => {
      const parsed = fallbackClassifierSchema.parse({
        sceneEntities: ['char_a'],
        worldTimeDelta: 0,
        summary: 'Kael drew.',
        retrievalQueries: ['a', 'b', 'c', 'd'],
      })
      expect(parsed.retrievalQueries).toBeUndefined()
      expect(parsed.summary).toBe('Kael drew.')
      expect(parsed.sceneEntities).toEqual(['char_a'])
    })

    // The prompt-injection path shows the model a JSON Schema, where null is the natural answer
    // for a field it has nothing for: one must not fail the parse and cost the turn its scene.
    it.each([
      ['currentLocation', { currentLocation: null }],
      ['visualChanges', { visualChanges: null }],
      ['summary', { summary: null }],
      ['transfers', { transfers: null }],
      ['transfers.items', { transfers: { items: null } }],
      ['transfers.stackables', { transfers: { stackables: null } }],
      [
        'transfers.items[].to and .from',
        { transfers: { items: [{ id: 'i1', slot: 'inventory', to: null, from: null }] } },
      ],
      [
        'transfers.stackables[].to and .from',
        { transfers: { stackables: [{ key: 'gold', amount: 3, to: null, from: null }] } },
      ],
    ] as const)('reads a null %s as omitted', (_field, nulled) => {
      const result = fallbackClassifierSchema.safeParse({
        sceneEntities: ['char_a'],
        worldTimeDelta: 30,
        ...nulled,
      })
      expect(result.success).toBe(true)
      expect(result.data?.sceneEntities).toEqual(['char_a'])
      expect(result.data?.worldTimeDelta).toBe(30)
      expect(JSON.stringify(result.data)).not.toContain('null')
    })

    // As conditions and drops already are: one entry the schema can't read drops alone.
    it.each([
      [
        'visualChanges',
        {
          visualChanges: [
            { id: 'c1', type: 'mood', text: 'x' },
            { id: 'c2', type: 'hair', text: 'wet' },
          ],
        },
        (d: z.infer<typeof fallbackClassifierSchema>) => d.visualChanges,
        [{ id: 'c2', type: 'hair', text: 'wet' }],
      ],
      [
        'transfers.items',
        {
          transfers: {
            items: [
              { id: 'i1', slot: 'pocket', to: 'c1' },
              { id: 'i2', slot: 'inventory', to: 'c1' },
            ],
          },
        },
        (d: z.infer<typeof fallbackClassifierSchema>) => d.transfers?.items,
        [{ id: 'i2', slot: 'inventory', to: 'c1' }],
      ],
      [
        'transfers.stackables',
        {
          transfers: {
            stackables: [
              { key: 'gold', amount: 'five', to: 'c1' },
              { key: 'arrows', amount: 4, to: 'c1' },
            ],
          },
        },
        (d: z.infer<typeof fallbackClassifierSchema>) => d.transfers?.stackables,
        [{ key: 'arrows', amount: 4, to: 'c1' }],
      ],
    ] as const)('drops a malformed %s entry alone', (_list, reply, read, kept) => {
      const result = fallbackClassifierSchema.safeParse({
        sceneEntities: ['char_a'],
        worldTimeDelta: 30,
        summary: 'Kael drew.',
        ...reply,
      })
      expect(result.success).toBe(true)
      expect(read(result.data!)).toEqual(kept)
      expect(result.data?.summary).toBe('Kael drew.')
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

    // This is the schema every real story runs (suggestionCategories is always populated); its
    // .extend() carries retrievalQueries but nothing else pins that — a refactor could drop Q4.
    it('carries retrievalQueries alongside suggestions', () => {
      const result = fallbackClassifierWithSuggestionsSchema.safeParse({
        sceneEntities: [],
        worldTimeDelta: 5,
        suggestions: [{ categoryRef: 'cat1', text: 'ok' }],
        retrievalQueries: ['a query'],
      })

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('expected parse to succeed')
      expect(result.data.retrievalQueries).toEqual(['a query'])
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

// piggyback.md → Trailing block format: the two writers are one contract, so the fallback's schema
// asks for what the emission prompt asks for, in the same words.
describe("fallbackClassifierSchema — the emission prompt's rules", () => {
  const emission = bundledPack.macros[MACRO_IDS.stateEmission]!.source
  const json = JSON.stringify(z.toJSONSchema(fallbackClassifierSchema))

  it.each([
    'restated from its current value shown above',
    'keep what still applies, drop what no longer does, in about 60 words',
    "exactly as the holder's Stackables line shows it",
    "only for something they don't hold yet",
    'never more than the payer holds',
    'replaces the stored condition whole',
    'in a few words, never more than about 60',
    'where the scene is',
    'still lying there when the turn ends',
    'only when nothing in Places could contain it',
  ])('says "%s" in both', (rule) => {
    expect(emission).toContain(rule)
    expect(json).toContain(rule.replaceAll('"', '\\"'))
  })
})
