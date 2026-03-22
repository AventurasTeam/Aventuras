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
import { settings } from '$lib/stores/settings.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { loadTestStory, loadTestSettings, clearTestStory } from './utils/storeHydration'
import {
  buildStory,
  buildEntry,
  buildCharacter,
  buildLocation,
  buildItem,
  buildStoryBeat,
  buildLorebookEntry,
  buildChapter,
} from '$test/factories'
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
    generationContext: {
      userAction: structuredClone(story.generationContext.userAction),
      narrationEntryId: story.generationContext.narrationEntryId,
      retrievalResult: structuredClone(story.generationContext.retrievalResult),
      narrativeResult: structuredClone(story.generationContext.narrativeResult),
      classificationResult: structuredClone(story.generationContext.classificationResult),
      translationResult: structuredClone(story.generationContext.translationResult),
      imageResult: structuredClone(story.generationContext.imageResult),
      postGenerationResult: structuredClone(story.generationContext.postGenerationResult),
      backgroundResult: structuredClone(story.generationContext.backgroundResult),
    },
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

function configureImageProfile() {
  const imageProfileId = 'test-image-profile'
  settings.imageProfiles = [
    {
      id: imageProfileId,
      name: 'Test Image Profile',
      providerType: 'pollinations',
      apiKey: '',
      model: 'flux',
      providerOptions: {},
      createdAt: Date.now(),
    },
  ]
  settings.systemServicesSettings.imageGeneration.profileId = imageProfileId
  settings.systemServicesSettings.imageGeneration.backgroundProfileId = imageProfileId
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

/** Rich classification result exercising all entity mutation paths. */
const richClassifierResult = {
  scene: {
    presentCharacterNames: ['Seraphina'],
    currentLocationName: 'Crystal Spire',
    timeProgression: 'hours',
  },
  entryUpdates: {
    characterUpdates: [
      {
        name: 'Seraphina',
        changes: {
          newTraits: ['brave', 'wounded'],
        },
      },
    ],
    locationUpdates: [],
    itemUpdates: [],
    storyBeatUpdates: [],
    newCharacters: [
      {
        name: 'Lyris',
        description: 'A mysterious stranger',
        relationship: 'neutral',
      },
    ],
    newLocations: [
      {
        name: 'Hidden Chamber',
        description: 'A secret room behind the crystal wall',
      },
    ],
    newItems: [
      {
        name: 'Crystal Shard',
        description: 'A glowing fragment of the spire',
      },
    ],
    newStoryBeats: [
      {
        title: 'The Stranger Appears',
        description: 'Lyris emerges from the shadows',
        type: 'event',
        status: 'active',
      },
    ],
  },
}

/** Suggestions matching suggestionsResultSchema. */
const defaultSuggestionsResult = {
  suggestions: [
    { text: 'The protagonist explores further', type: 'action' },
    { text: '"We need to move quickly," she said', type: 'dialogue' },
    { text: 'A hidden passage reveals itself', type: 'revelation' },
  ],
}

/** Timeline fill query generation result. */
const timelineFillQueriesResult = {
  queries: [{ query: 'What happened when Kael escaped the dungeon?' }],
}

/** Background image analysis result. */
const backgroundImageResult = {
  changeNecessary: false,
  prompt: '',
}

/** Image prompt analysis result. */
const imageAnalysisResult = {
  scenes: [
    {
      prompt: 'A warrior enters a crystal spire with dagger drawn',
      sceneType: 'action',
      priority: 5,
      sourceText: 'Kael draws the Obsidian Dagger and enters the spire.',
      characters: [],
      generatePortrait: false,
    },
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
    settings.systemServicesSettings.imageGeneration.profileId = null
    settings.systemServicesSettings.imageGeneration.backgroundProfileId = null
    settings.imageProfiles = []
    settings.systemServicesSettings.timelineFill.enabled = false
    ui.lastStyleReview = null
  })

  // --------------------------------------------------------------------------
  // 1. Full pipeline mega-test
  // --------------------------------------------------------------------------

  it('full pipeline: all phases fire with rich world state', async ({ task }) => {
    // ---- World state setup ----
    const testStory = buildStory({
      mode: 'creative-writing',
      settings: {
        pov: 'third',
        tense: 'past',
        imageGenerationMode: 'agentic',
        backgroundImagesEnabled: true,
      },
      memoryConfig: {
        tokenThreshold: 16000,
        chapterBuffer: 2,
        autoSummarize: true,
        enableRetrieval: true,
        maxChaptersPerRetrieval: 3,
      },
    })

    const protagonist = buildCharacter({
      storyId: testStory.id,
      name: 'Kael',
      relationship: 'self',
    })
    const ally = buildCharacter({
      storyId: testStory.id,
      name: 'Seraphina',
      relationship: 'ally',
      status: 'active',
    })
    const enemy = buildCharacter({
      storyId: testStory.id,
      name: 'Malachar',
      relationship: 'enemy',
      status: 'active',
    })

    const currentLoc = buildLocation({
      storyId: testStory.id,
      name: 'Crystal Spire',
      current: true,
      visited: true,
    })
    const visitedLoc = buildLocation({
      storyId: testStory.id,
      name: 'Shadow Market',
      current: false,
      visited: true,
    })

    const dagger = buildItem({
      storyId: testStory.id,
      name: 'Obsidian Dagger',
      location: 'inventory',
      equipped: true,
    })
    const scroll = buildItem({
      storyId: testStory.id,
      name: 'Ancient Scroll',
      location: 'Shadow Market',
    })

    const activeQuest = buildStoryBeat({
      storyId: testStory.id,
      title: 'Find the Lost Artifact',
      type: 'quest',
      status: 'active',
    })
    const completedQuest = buildStoryBeat({
      storyId: testStory.id,
      title: 'Escape the Dungeon',
      type: 'quest',
      status: 'completed',
    })

    const chapter = buildChapter({
      storyId: testStory.id,
      number: 1,
      title: 'The Escape',
      summary: 'Kael escaped the dungeon with the help of Seraphina.',
      keywords: ['dungeon', 'escape'],
    })

    // Lorebook entries: always-inject, keyword-match, and tier-3 candidate
    const alwaysInjectLore = buildLorebookEntry({
      storyId: testStory.id,
      name: 'World Lore',
      description: 'The realm of Aethermoor is a land of ancient magic and forgotten kingdoms.',
      injection: { mode: 'always', keywords: [], priority: 0 },
      type: 'concept',
    })
    const keywordLore = buildLorebookEntry({
      storyId: testStory.id,
      name: 'Crystal Spire Legend',
      description: 'The Crystal Spire was built by the Arcane Order to channel ley line energy.',
      injection: { mode: 'keyword', keywords: ['crystal', 'spire'], priority: 0 },
      type: 'concept',
    })
    const tier3Lore = buildLorebookEntry({
      storyId: testStory.id,
      name: 'Ancient Prophecy',
      description: 'A forgotten prophecy about the convergence of realms.',
      injection: { mode: 'keyword', keywords: ['oracle', 'prophecy'], priority: 0 },
      type: 'concept',
    })

    // Story history entries
    const entries = [
      buildEntry({
        storyId: testStory.id,
        type: 'narration',
        content: 'The dungeon crumbled behind Kael as he escaped into daylight.',
        position: 0,
      }),
      buildEntry({
        storyId: testStory.id,
        type: 'user_action',
        content: 'Kael heads toward the Crystal Spire',
        position: 1,
      }),
      buildEntry({
        storyId: testStory.id,
        type: 'narration',
        content: 'The Crystal Spire loomed ahead, its facets catching the last rays of sunset.',
        position: 2,
      }),
      buildEntry({
        storyId: testStory.id,
        type: 'user_action',
        content: 'Kael examines the entrance',
        position: 3,
      }),
      buildEntry({
        storyId: testStory.id,
        type: 'narration',
        content:
          'Seraphina pointed to ancient runes carved above the archway. "These are warnings," she said.',
        position: 4,
      }),
    ]

    loadTestStory({
      story: testStory,
      characters: [protagonist, ally, enemy],
      locations: [currentLoc, visitedLoc],
      items: [dagger, scroll],
      storyBeats: [activeQuest, completedQuest],
      entries,
      lorebookEntries: [alwaysInjectLore, keywordLore, tier3Lore],
      chapters: [chapter],
    })

    loadTestSettings({ disableSuggestions: false })

    // Enable timeline fill retrieval
    settings.systemServicesSettings.timelineFill.enabled = true

    // Configure image profiles
    configureImageProfile()

    // Set style review
    ui.lastStyleReview = {
      phrases: [
        {
          phrase: 'passive constructions',
          frequency: 3,
          severity: 'medium',
          alternatives: ['use active voice'],
          contexts: ['The door was opened by...'],
        },
      ],
      overallAssessment: 'Avoid passive voice.',
      reviewedEntryCount: 5,
      timestamp: Date.now(),
    }

    // ---- Register mock handlers ----
    const narrativeText =
      'Kael draws the Obsidian Dagger and steps through the archway into the Crystal Spire. The air shimmers with ancient energy as Seraphina follows close behind.'

    interceptor
      .on('timeline-fill', respondWithJSON(timelineFillQueriesResult))
      .on(
        'timeline-fill-answer',
        respondWithStream('Kael fought through the dungeon guards and escaped with Seraphina.'),
      )
      .on(
        'tier3-entry-selection',
        respondWithJSON({ selectedIds: [tier3Lore.id], reasoning: 'Found relevant entry' }),
      )
      .on('narrative', respondWithStream(narrativeText))
      .on('background-image-prompt-analysis', respondWithJSON(backgroundImageResult))
      .on('classifier', respondWithJSON(richClassifierResult))
      .on('image-prompt-analysis', respondWithJSON(imageAnalysisResult))
      .on('suggestions', respondWithJSON(defaultSuggestionsResult))

    // ---- Execute pipeline ----
    const userActionEntry = await story.entry.addEntry(
      'user_action',
      'Kael enters the spire with his blade drawn',
    )

    const callbacks = buildMockCallbacks()
    // Override getLastStyleReview to read live from ui store (default mock returns null)
    callbacks.getLastStyleReview = () => ui.lastStyleReview
    const controller = new ActionInputController(callbacks)

    const tracer = createAutoTracer(getStoreState)
    interceptor.connectTracer(tracer)

    await controller.generateResponse(userActionEntry.id, userActionEntry.content)

    // ---- Assertions: Retrieval phase ----
    expect(interceptor.getRequests('timeline-fill').length).toBeGreaterThan(0)
    expect(interceptor.getRequests('timeline-fill-answer').length).toBeGreaterThan(0)
    expect(interceptor.getRequests('tier3-entry-selection').length).toBeGreaterThan(0)

    // Narrative prompt contains lorebook content
    expectPromptContains(interceptor, 'narrative', 'Aethermoor')
    expectPromptContains(interceptor, 'narrative', 'Arcane Order')

    // ---- Assertions: Narrative phase ----
    expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)
    expect(callbacks.appendStreamContent).toHaveBeenCalled()

    // Prompt contains world state
    expectPromptContains(interceptor, 'narrative', 'Seraphina')
    expectPromptContains(interceptor, 'narrative', 'Kael')
    expectPromptContains(interceptor, 'narrative', 'Crystal Spire')
    expectPromptContains(interceptor, 'narrative', 'Obsidian Dagger')
    expectPromptContains(interceptor, 'narrative', 'Kael enters the spire with his blade drawn')
    expectPromptNotContains(interceptor, 'narrative', 'I Kael enters the spire')
    expectPromptContains(interceptor, 'narrative', 'Find the Lost Artifact')

    // Prompt contains injected lorebook entries
    expectPromptContains(interceptor, 'narrative', 'World Lore')
    expectPromptContains(
      interceptor,
      'narrative',
      'The realm of Aethermoor is a land of ancient magic and forgotten kingdoms.',
    )
    expectPromptContains(interceptor, 'narrative', 'Ancient Prophecy')
    expectPromptContains(
      interceptor,
      'narrative',
      'A forgotten prophecy about the convergence of realms.',
    )
    expectPromptContains(interceptor, 'narrative', 'Crystal Spire Legend')
    expectPromptContains(
      interceptor,
      'narrative',
      'The Crystal Spire was built by the Arcane Order to channel ley line energy.',
    )

    // Creative-writing template uses author/direction framing
    expectPromptContains(interceptor, 'narrative', 'author')

    // Style review injected
    expectPromptContains(interceptor, 'narrative', 'passive constructions')

    // Narrative response emitted and entry added
    expect(callbacks.emitNarrativeResponse).toHaveBeenCalledWith(expect.any(String), narrativeText)
    const narrationEntries = story.entry.entries.filter(
      (e) => e.type === 'narration' && e.content === narrativeText,
    )
    expect(narrationEntries.length).toBe(1)

    // ---- Assertions: Background image phase ----
    expect(interceptor.getRequests('background-image-prompt-analysis').length).toBeGreaterThan(0)

    // ---- Assertions: Classification phase ----
    expect(interceptor.getRequests('classifier').length).toBeGreaterThan(0)

    // Entity updates applied to store
    const seraphina = story.character.characters.find((c) => c.name === 'Seraphina')
    expect(seraphina?.traits).toContain('brave')
    expect(seraphina?.traits).toContain('wounded')

    // New entities added
    expect(story.character.characters.find((c) => c.name === 'Lyris')).toBeDefined()
    expect(story.location.locations.find((l) => l.name === 'Hidden Chamber')).toBeDefined()
    expect(story.item.items.find((i) => i.name === 'Crystal Shard')).toBeDefined()
    expect(story.storyBeat.storyBeats.find((b) => b.title === 'The Stranger Appears')).toBeDefined()

    // Time progression applied (hours → adds time to timeTracker)
    expect(story.currentStory?.timeTracker).not.toBeNull()

    // ---- Assertions: Image phase ----
    expect(interceptor.getRequests('image-prompt-analysis').length).toBeGreaterThan(0)

    // ---- Assertions: Post-generation phase (suggestions, not action choices) ----
    expect(interceptor.getRequests('suggestions').length).toBeGreaterThan(0)
    expect(callbacks.setSuggestions).toHaveBeenCalled()
    expect(callbacks.setActionChoices).not.toHaveBeenCalled()

    // ---- Assertions: Pipeline lifecycle ----
    expect(callbacks.setGenerating).toHaveBeenCalledWith(true)
    expect(callbacks.startStreaming).toHaveBeenCalled()
    expect(callbacks.endStreaming).toHaveBeenCalled()
    expect(callbacks.setGenerating).toHaveBeenCalledWith(false)

    tracer.finalize()
    ;(task.meta as any).traceData = tracer.export()
  })

  // --------------------------------------------------------------------------
  // 2. handleSubmit with isCreativeWritingMode=true — no prefix applied
  // --------------------------------------------------------------------------

  it('handleSubmit with isCreativeWritingMode=true: no prefix applied', async ({ task }) => {
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
          content: 'The story begins.',
          position: 0,
        }),
      ],
    })
    loadTestSettings({ disableSuggestions: true })

    interceptor.on('narrative', respondWithStream('The rain intensified.'))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)

    const tracer = createAutoTracer(getStoreState)
    interceptor.connectTracer(tracer)

    const input: SubmitInput = {
      inputValue: 'describe the rain falling',
      actionType: 'do',
      isRawActionChoice: false,
      isCreativeWritingMode: true,
      actionPrefixes: { do: 'I ', say: 'I say, "', think: 'I think, "', story: '', free: '' },
      actionSuffixes: { do: '', say: '"', think: '"', story: '', free: '' },
    }

    await controller.handleSubmit(input)

    expectPromptNotContains(interceptor, 'narrative', 'I describe the rain falling')
    expectPromptContains(interceptor, 'narrative', 'describe the rain falling')

    expect(callbacks.endStreaming).toHaveBeenCalled()
    expect(callbacks.setGenerating).toHaveBeenCalledWith(false)

    tracer.finalize()
    ;(task.meta as any).traceData = tracer.export()
  })

  // --------------------------------------------------------------------------
  // 3. Suggestions disabled — skips post-generation
  // --------------------------------------------------------------------------

  it('suggestions disabled: skips post-generation', async ({ task }) => {
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
          content: 'The story begins.',
          position: 0,
        }),
      ],
    })
    loadTestSettings({ disableSuggestions: true })

    interceptor.on('narrative', respondWithStream('The narrative continues.'))
    interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

    const userActionEntry = await story.entry.addEntry('user_action', 'Continue the scene')

    const callbacks = buildMockCallbacks()
    const controller = new ActionInputController(callbacks)

    const tracer = createAutoTracer(getStoreState)
    interceptor.connectTracer(tracer)

    await controller.generateResponse(userActionEntry.id, userActionEntry.content)

    expect(interceptor.getRequests('suggestions').length).toBe(0)
    expect(callbacks.setSuggestions).not.toHaveBeenCalled()

    tracer.finalize()
    ;(task.meta as any).traceData = tracer.export()
  })
})
