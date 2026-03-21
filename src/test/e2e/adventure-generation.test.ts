/**
 * Adventure Mode Generation Tests
 *
 * E2E tests exercising the full ActionInputController pipeline in adventure mode.
 * Uses real stores + fetch interception.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---- Hoisted mocks (must be before any $lib imports) ----

const interceptorRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/ai/sdk/providers/fetch', () => ({
  createTimeoutFetch: (_timeout: number, serviceId: string) => {
    return (
      interceptorRef.current?.createFetchForService(serviceId) ??
      (() => Promise.reject(new Error('No interceptor')))
    )
  },
}))

vi.mock('$lib/services/tokenizer', () => ({
  countTokens: () => 100,
  tokenize: (text: string) => text.split(' '),
}))

const dbMockRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/database', () => ({
  get database() {
    return dbMockRef.current
  },
}))

// ---- Imports (after mocks) ----

import { story } from '$lib/stores/story/index.svelte'
import { loadTestStory, loadTestSettings, clearTestStory } from './utils/storeHydration'
import { buildStory, buildEntry, buildCharacter, buildLocation, buildItem } from '$test/factories'
import { FetchInterceptor, respondWithStream, respondWithJSON } from './utils/FetchInterceptor'
import { createDatabaseMock } from './utils/databaseMock'
import { expectPromptContains, expectPromptNotContains } from './utils/assertions'
import {
  ActionInputController,
  type ActionInputCallbacks,
  type SubmitInput,
} from '$lib/services/generation/ActionInputController'
import { createAutoTracer } from './utils/TestTracer'

// ============================================================================
// Helpers
// ============================================================================

function getStoreState() {
  return {
    entries: structuredClone(story.entry.entries),
    characters: structuredClone(story.character.characters),
    locations: structuredClone(story.location.locations),
    items: structuredClone(story.item.items),
    storyBeats: structuredClone(story.storyBeat.storyBeats),
    chapters: structuredClone(story.chapter.chapters),
  }
}

function buildMockCallbacks(): ActionInputCallbacks {
  return {
    startStreaming: vi.fn(),
    endStreaming: vi.fn(),
    appendStreamContent: vi.fn(),
    appendReasoningContent: vi.fn(),
    setGenerating: vi.fn(),
    clearGenerationError: vi.fn(),
    setGenerationError: vi.fn(),
    setGenerationStatus: vi.fn(),
    setSuggestionsLoading: vi.fn(),
    setActionChoicesLoading: vi.fn(),
    setSuggestions: vi.fn(),
    setActionChoices: vi.fn(),
    clearSuggestions: vi.fn(),
    clearActionChoices: vi.fn(),
    createRetryBackup: vi.fn(),
    clearRetryBackup: vi.fn(),
    getRetryBackup: vi.fn().mockReturnValue(null),
    isRetryingLastMessage: vi.fn().mockReturnValue(false),
    setRetryingLastMessage: vi.fn(),
    updateActivationData: vi.fn(),
    getActivationTracker: vi.fn().mockReturnValue(null),
    restoreActivationData: vi.fn(),
    clearActivationData: vi.fn(),
    setLastLorebookRetrieval: vi.fn(),
    getLastStyleReview: vi.fn().mockReturnValue(null),
    emitNarrativeResponse: vi.fn(),
    emitUserInput: vi.fn(),
    emitResponseStreaming: vi.fn(),
    emitSuggestionsReady: vi.fn(),
    emitTTSQueued: vi.fn(),
    sendGenerationNotification: vi.fn(),
    wasBackgroundedDuringGeneration: vi.fn().mockReturnValue(false),
    isAppBackgrounded: vi.fn().mockReturnValue(false),
    resetBackgroundedFlag: vi.fn(),
    startGenerationService: vi.fn(),
    stopGenerationService: vi.fn(),
    shouldUseBackgroundService: vi.fn().mockReturnValue(false),
    resetScrollBreak: vi.fn(),
    getLastGenerationError: vi.fn().mockReturnValue(null),
  }
}

/**
 * Standard classifier response matching the classificationResultSchema.
 * Uses respondWithJSON since generateStructured uses Output.object (not tool calls).
 */
const defaultClassifierResult = {
  scene: {
    presentCharacterNames: [],
    currentLocationName: null,
    timeProgression: 'none',
  },
  entryUpdates: {
    characterUpdates: [],
    locationUpdates: [],
    itemUpdates: [],
    storyBeatUpdates: [],
    newCharacters: [],
    newLocations: [],
    newItems: [],
    newStoryBeats: [],
  },
}

// ============================================================================
// Test suite
// ============================================================================

describe('Adventure Mode — ActionInputController E2E', () => {
  let interceptor: FetchInterceptor
  let dbMock: ReturnType<typeof createDatabaseMock>

  beforeEach(() => {
    dbMock = createDatabaseMock()
    dbMockRef.current = dbMock

    interceptor = new FetchInterceptor()
    interceptor.install()
    interceptorRef.current = interceptor
  })

  afterEach(() => {
    interceptor.restore()
    clearTestStory()
  })

  // --------------------------------------------------------------------------
  // 1. Happy path — full pipeline with characters, locations, items
  // --------------------------------------------------------------------------

  it('happy path: narrative prompt includes world state and user action, streams, classifies', async ({ task }) => {
    const testStory = buildStory({
      mode: 'adventure',
      settings: {
        pov: 'second',
        tense: 'past',
        imageGenerationMode: 'none',
        backgroundImagesEnabled: false,
      },
    })
    const char = buildCharacter({ storyId: testStory.id, name: 'Seraphina', relationship: 'ally' })
    const loc = buildLocation({ storyId: testStory.id, name: 'Crystal Spire', current: true })
    const item = buildItem({
      storyId: testStory.id,
      name: 'Obsidian Dagger',
      location: 'inventory',
    })

    loadTestStory({
      story: testStory,
      characters: [char],
      locations: [loc],
      items: [item],
      entries: [
        buildEntry({
          storyId: testStory.id,
          type: 'narration',
          content: 'You stand before the towering Crystal Spire.',
          position: 0,
        }),
      ],
    })

    loadTestSettings({ disableSuggestions: true })

    const narrativeText = 'You draw the Obsidian Dagger and enter the spire.'

    interceptor.on('narrative', respondWithStream(narrativeText))
    interceptor.on(
      'classifier',
      respondWithJSON({
        ...defaultClassifierResult,
        scene: {
          ...defaultClassifierResult.scene,
          presentCharacterNames: ['Seraphina'],
          currentLocationName: 'Crystal Spire',
        },
      }),
    )

    // Add a user_action entry then call generateResponse
    const userActionEntry = await story.entry.addEntry(
      'user_action',
      'I enter the spire with my blade drawn',
    )

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)

    const tracer = createAutoTracer(getStoreState)
    interceptor.connectTracer(tracer)

    await controller.generateResponse(userActionEntry.id, userActionEntry.content)

    // Narrative request was made and streamed
    expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

    // Narrative prompt contains character, location, item names and the user action
    expectPromptContains(interceptor, 'narrative', 'Seraphina')
    expectPromptContains(interceptor, 'narrative', 'Crystal Spire')
    expectPromptContains(interceptor, 'narrative', 'Obsidian Dagger')
    expectPromptContains(interceptor, 'narrative', 'I enter the spire with my blade drawn')

    // Classification was called
    expect(interceptor.getRequests('classifier').length).toBeGreaterThan(0)

    // endStreaming and setGenerating(false) are always called (in finally block)
    expect(callbacks.endStreaming).toHaveBeenCalled()
    expect(callbacks.setGenerating).toHaveBeenCalledWith(false)

    // emitNarrativeResponse was called with the accumulated content
    expect(callbacks.emitNarrativeResponse).toHaveBeenCalledWith(expect.any(String), narrativeText)

    tracer.finalize()
    task.meta.traceData = tracer.export()
  })

  // --------------------------------------------------------------------------
  // 2. Minimal story — first entry, empty world state
  // --------------------------------------------------------------------------

  it('minimal story: no world state — narrative still succeeds, no CANONICAL section', async ({ task }) => {
    const testStory = buildStory({
      mode: 'adventure',
      settings: {
        pov: 'second',
        tense: 'past',
        imageGenerationMode: 'none',
        backgroundImagesEnabled: false,
      },
    })

    loadTestStory({ story: testStory })
    loadTestSettings({ disableSuggestions: true })

    const narrativeText = 'The blank world awaits your first step.'

    interceptor.on('narrative', respondWithStream(narrativeText))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

    const userActionEntry = await story.entry.addEntry('user_action', 'I look around')

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)

    const tracer = createAutoTracer(getStoreState)
    interceptor.connectTracer(tracer)

    await controller.generateResponse(userActionEntry.id, userActionEntry.content)

    expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

    // No world-state entities — CANONICAL sections should not appear
    expectPromptNotContains(interceptor, 'narrative', 'CANONICAL CHARACTERS')
    expectPromptNotContains(interceptor, 'narrative', 'CANONICAL LOCATIONS')
    expectPromptNotContains(interceptor, 'narrative', 'CANONICAL ITEMS')

    expect(callbacks.endStreaming).toHaveBeenCalled()
    expect(callbacks.setGenerating).toHaveBeenCalledWith(false)

    tracer.finalize()
    task.meta.traceData = tracer.export()
  })

  // --------------------------------------------------------------------------
  // 3. Action type prefix tests
  // --------------------------------------------------------------------------

  describe('action type prefix tests', () => {
    const ACTION_PREFIXES: Record<string, string> = {
      do: 'I ',
      say: 'I say, "',
      think: 'I think to myself, "',
      story: '',
      free: '',
    }
    const ACTION_SUFFIXES: Record<string, string> = {
      do: '',
      say: '"',
      think: '"',
      story: '',
      free: '',
    }

    function setupAdventureStory() {
      const testStory = buildStory({
        mode: 'adventure',
        settings: {
          pov: 'second',
          tense: 'past',
          imageGenerationMode: 'none',
          backgroundImagesEnabled: false,
        },
      })
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The story begins.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })
      return testStory
    }

    function setupHandlers() {
      interceptor.on('narrative', respondWithStream('The narrative continues.'))
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))
    }

    async function runHandleSubmit(
      inputValue: string,
      actionType: 'do' | 'say' | 'think' | 'story' | 'free',
    ) {
      const callbacks = buildMockCallbacks()
      const controller = new ActionInputController(callbacks)

      const input: SubmitInput = {
        inputValue,
        actionType,
        isRawActionChoice: false,
        isCreativeWritingMode: false,
        actionPrefixes: ACTION_PREFIXES,
        actionSuffixes: ACTION_SUFFIXES,
      }

      await controller.handleSubmit(input)
      return callbacks
    }

    it('do: prompt contains "I " + input', async ({ task }) => {
      setupAdventureStory()
      setupHandlers()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await runHandleSubmit('run toward the exit', 'do')

      expectPromptContains(interceptor, 'narrative', 'I run toward the exit')

      tracer.finalize()
      task.meta.traceData = tracer.export()
    })

    it("say: prompt contains 'I say, \"' + input + '\"'", async ({ task }) => {
      setupAdventureStory()
      setupHandlers()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await runHandleSubmit('Hello there', 'say')

      expectPromptContains(interceptor, 'narrative', 'I say, "Hello there"')

      tracer.finalize()
      task.meta.traceData = tracer.export()
    })

    it("think: prompt contains 'I think to myself, \"' + input + '\"'", async ({ task }) => {
      setupAdventureStory()
      setupHandlers()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await runHandleSubmit('this is dangerous', 'think')

      expectPromptContains(interceptor, 'narrative', 'I think to myself, "this is dangerous"')

      tracer.finalize()
      task.meta.traceData = tracer.export()
    })

    it('story: prompt contains raw input without prefix', async ({ task }) => {
      setupAdventureStory()
      setupHandlers()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await runHandleSubmit('Suddenly the lights went out', 'story')

      expectPromptContains(interceptor, 'narrative', 'Suddenly the lights went out')
      expectPromptNotContains(interceptor, 'narrative', 'I Suddenly')

      tracer.finalize()
      task.meta.traceData = tracer.export()
    })

    it('free: prompt contains raw input without prefix', async ({ task }) => {
      setupAdventureStory()
      setupHandlers()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await runHandleSubmit('Anything goes here', 'free')

      expectPromptContains(interceptor, 'narrative', 'Anything goes here')
      expectPromptNotContains(interceptor, 'narrative', 'I Anything')

      tracer.finalize()
      task.meta.traceData = tracer.export()
    })
  })

  // --------------------------------------------------------------------------
  // 4. POV variation tests
  // --------------------------------------------------------------------------

  describe('POV variation tests', () => {
    function setupHandlers() {
      interceptor.on('narrative', respondWithStream('The narrative continues.'))
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))
    }

    it('second person: prompt contains "I " prefix for do action', async ({ task }) => {
      const testStory = buildStory({
        mode: 'adventure',
        settings: {
          pov: 'second',
          tense: 'past',
          imageGenerationMode: 'none',
          backgroundImagesEnabled: false,
        },
      })
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({ storyId: testStory.id, type: 'narration', content: 'Begin.', position: 0 }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })
      setupHandlers()

      const userActionEntry = await story.entry.addEntry('user_action', 'I move forward')
      const callbacks = buildMockCallbacks()
      const controller = new ActionInputController(callbacks)

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse(userActionEntry.id, userActionEntry.content)

      expectPromptContains(interceptor, 'narrative', 'I move forward')

      tracer.finalize()
      task.meta.traceData = tracer.export()
    })

    it('third person: handleSubmit with third-person prefix uses protagonist name', async ({ task }) => {
      const testStory = buildStory({
        mode: 'adventure',
        settings: {
          pov: 'third',
          tense: 'past',
          imageGenerationMode: 'none',
          backgroundImagesEnabled: false,
        },
      })
      // Protagonist is relationship: 'self'
      const protagonist = buildCharacter({
        storyId: testStory.id,
        name: 'Kael',
        relationship: 'self',
      })
      loadTestStory({
        story: testStory,
        characters: [protagonist],
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'Kael stands at the threshold.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })
      setupHandlers()

      // Third-person prefixes use protagonist name
      const thirdPersonPrefixes: Record<string, string> = {
        do: 'Kael ',
        say: 'Kael says, "',
        think: 'Kael thinks, "',
        story: '',
        free: '',
      }
      const actionSuffixes: Record<string, string> = {
        do: '',
        say: '"',
        think: '"',
        story: '',
        free: '',
      }

      const callbacks = buildMockCallbacks()
      const controller = new ActionInputController(callbacks)

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleSubmit({
        inputValue: 'steps forward',
        actionType: 'do',
        isRawActionChoice: false,
        isCreativeWritingMode: false,
        actionPrefixes: thirdPersonPrefixes,
        actionSuffixes,
      })

      // Third-person: prompt should contain "Kael steps forward"
      expectPromptContains(interceptor, 'narrative', 'Kael steps forward')
      // Should NOT contain the second-person "I " prefix form
      expectPromptNotContains(interceptor, 'narrative', 'I steps forward')

      tracer.finalize()
      task.meta.traceData = tracer.export()
    })
  })
})
