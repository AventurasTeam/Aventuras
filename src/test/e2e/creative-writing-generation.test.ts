/**
 * Creative Writing Mode Generation Tests
 *
 * E2E tests exercising the full ActionInputController pipeline in creative-writing mode.
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
import { buildStory, buildEntry, buildCharacter } from '$test/factories'
import { FetchInterceptor, respondWithStream, respondWithJSON } from './utils/FetchInterceptor'
import { createDatabaseMock } from './utils/databaseMock'
import { expectPromptContains, expectPromptNotContains } from './utils/assertions'
import {
  ActionInputController,
  type ActionInputCallbacks,
} from '$lib/services/generation/ActionInputController'

// ============================================================================
// Helpers
// ============================================================================

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

/**
 * Minimal suggestions response matching the suggestionsResultSchema.
 */
const defaultSuggestionsResult = {
  suggestions: [
    { text: 'The protagonist explores further', type: 'action' },
    { text: '"We need to move quickly," she said', type: 'dialogue' },
    { text: 'A hidden passage reveals itself', type: 'revelation' },
  ],
}

// ============================================================================
// Test suite
// ============================================================================

describe('Creative Writing Mode — ActionInputController E2E', () => {
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
  // 1. Happy path — creative-writing mode generation via generateResponse
  // --------------------------------------------------------------------------

  it('happy path: direction input is not prefixed, narrative streams, pipeline completes', async () => {
    const testStory = buildStory({
      mode: 'creative-writing',
      settings: {
        pov: 'third',
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
          content: 'The ancient tower stood silent against the moonlit sky.',
          position: 0,
        }),
      ],
    })
    loadTestSettings({ disableSuggestions: true })

    const narrativeText = 'The tower groaned as dust cascaded from the crumbling archway.'

    interceptor.on('narrative', respondWithStream(narrativeText))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

    // In creative writing mode, direction is stored raw — no "I " prefix applied
    const directionContent = 'The ancient tower crumbles slowly'
    const userActionEntry = await story.entry.addEntry('user_action', directionContent)

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)
    await controller.generateResponse(userActionEntry.id, userActionEntry.content)

    // Narrative request was made
    expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

    // Direction content appears in the prompt without an "I " prefix prepended
    expectPromptContains(interceptor, 'narrative', directionContent)

    // Narrative was streamed
    expect(callbacks.endStreaming).toHaveBeenCalled()
    expect(callbacks.setGenerating).toHaveBeenCalledWith(false)

    // emitNarrativeResponse was called with the streamed content
    expect(callbacks.emitNarrativeResponse).toHaveBeenCalledWith(expect.any(String), narrativeText)
  })

  // --------------------------------------------------------------------------
  // 2. handleSubmit with isCreativeWritingMode=true — no prefix/suffix applied
  // --------------------------------------------------------------------------

  it('handleSubmit with isCreativeWritingMode=true: raw input used, no "I " prefix', async () => {
    const testStory = buildStory({
      mode: 'creative-writing',
      settings: {
        pov: 'third',
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
          content: 'The story begins in a forgotten city.',
          position: 0,
        }),
      ],
    })
    loadTestSettings({ disableSuggestions: true })

    interceptor.on('narrative', respondWithStream('She stepped into the ruined hall.'))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)

    await controller.handleSubmit({
      inputValue: 'The ancient tower crumbles',
      actionType: 'do',
      isRawActionChoice: false,
      isCreativeWritingMode: true,
      actionPrefixes: { do: 'I ', say: 'I say, "', think: 'I think, "', story: '', free: '' },
      actionSuffixes: { do: '', say: '"', think: '"', story: '', free: '' },
    })

    // Prompt must NOT contain "I The ancient" (prefix was skipped)
    expectPromptNotContains(interceptor, 'narrative', 'I The ancient tower crumbles')

    // Raw input must appear in the prompt
    expectPromptContains(interceptor, 'narrative', 'The ancient tower crumbles')

    // Pipeline completed normally
    expect(callbacks.endStreaming).toHaveBeenCalled()
    expect(callbacks.setGenerating).toHaveBeenCalledWith(false)
  })

  // --------------------------------------------------------------------------
  // 3. Post-generation: suggestions produced, not action choices
  // --------------------------------------------------------------------------

  it('post-generation: setSuggestions is called; setActionChoices is NOT called', async () => {
    const testStory = buildStory({
      mode: 'creative-writing',
      settings: {
        pov: 'third',
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
          content: 'The river ran swift beneath the stone bridge.',
          position: 0,
        }),
      ],
    })
    // Enable suggestions so post-generation runs
    loadTestSettings({ disableSuggestions: false })

    interceptor.on('narrative', respondWithStream('She crossed the bridge at dusk.'))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))
    interceptor.on('suggestions', respondWithJSON(defaultSuggestionsResult))

    const userActionEntry = await story.entry.addEntry('user_action', 'Cross the bridge')

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)
    await controller.generateResponse(userActionEntry.id, userActionEntry.content)

    // suggestions service was called
    expect(interceptor.getRequests('suggestions').length).toBeGreaterThan(0)

    // setSuggestions was called with results
    expect(callbacks.setSuggestions).toHaveBeenCalled()

    // setActionChoices must NOT have been called (that's adventure-mode behaviour)
    expect(callbacks.setActionChoices).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 4. Creative-writing template elements appear in narrative prompt
  // --------------------------------------------------------------------------

  it('narrative prompt contains creative-writing template elements (author direction framing)', async () => {
    const testStory = buildStory({
      mode: 'creative-writing',
      settings: {
        pov: 'third',
        tense: 'past',
        imageGenerationMode: 'none',
        backgroundImagesEnabled: false,
      },
    })

    const protagonist = buildCharacter({
      storyId: testStory.id,
      name: 'Lyra',
      relationship: 'self',
    })

    loadTestStory({
      story: testStory,
      characters: [protagonist],
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

    interceptor.on('narrative', respondWithStream('Lyra stood at the edge of the world.'))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

    const userActionEntry = await story.entry.addEntry(
      'user_action',
      'Lyra moves toward the horizon',
    )

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)
    await controller.generateResponse(userActionEntry.id, userActionEntry.content)

    // Template signals author-direction framing (from creative-writing system template)
    expectPromptContains(interceptor, 'narrative', 'author')

    // Protagonist name is rendered in the template
    expectPromptContains(interceptor, 'narrative', 'Lyra')

    // Adventure-mode CANONICAL sections should NOT appear
    expectPromptNotContains(interceptor, 'narrative', 'CANONICAL CHARACTERS')
  })

  // --------------------------------------------------------------------------
  // 5. Verify "I " prefix is absent even when actionType is 'do'
  // --------------------------------------------------------------------------

  it('do action type with isCreativeWritingMode=true: no "I " prefix injected', async () => {
    const testStory = buildStory({
      mode: 'creative-writing',
      settings: {
        pov: 'third',
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
          content: 'Rain fell on the cobblestones.',
          position: 0,
        }),
      ],
    })
    loadTestSettings({ disableSuggestions: true })

    interceptor.on('narrative', respondWithStream('The rain intensified.'))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)

    await controller.handleSubmit({
      inputValue: 'describe the rain',
      actionType: 'do',
      isRawActionChoice: false,
      isCreativeWritingMode: true,
      actionPrefixes: { do: 'I ', say: 'I say, "', think: 'I think, "', story: '', free: '' },
      actionSuffixes: { do: '', say: '"', think: '"', story: '', free: '' },
    })

    // "I describe the rain" must NOT appear — the prefix was skipped
    expectPromptNotContains(interceptor, 'narrative', 'I describe the rain')

    // Raw direction must appear
    expectPromptContains(interceptor, 'narrative', 'describe the rain')
  })
})
