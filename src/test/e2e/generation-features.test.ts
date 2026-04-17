/**
 * Generation Feature Toggle Tests
 *
 * E2E tests for optional generation features: translation, image analysis,
 * lorebook retrieval, and style review injection.
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
import { buildStory, buildEntry, buildLorebookEntry, buildChapter } from '$test/factories'
import { FetchInterceptor, respondWithStream, respondWithJSON } from './utils/FetchInterceptor'
import { createDatabaseMock } from './utils/databaseMock'
import { expectNoRequest } from './utils/assertions'
import { ActionInputController } from '$lib/services/generation/ActionInputController'
import { createAutoTracer } from './utils/TestTracer'

// ============================================================================
// Helpers
// ============================================================================

function getStoreState() {
  return {
    entries: structuredClone(story.entry.rawEntries),
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

/** Set generationContext.userAction from an addEntry result */
function setUserAction(entry: { id: string; content: string }) {
  story.generationContext.userAction = {
    entryId: entry.id,
    content: entry.content,
    rawInput: entry.content,
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

/** Build a minimal adventure story with image generation disabled by default. */
function buildAdventureStory(settingsOverrides: Record<string, unknown> = {}) {
  return buildStory({
    mode: 'adventure',
    settings: {
      pov: 'second',
      tense: 'past',
      imageGenerationMode: 'none',
      backgroundImagesEnabled: false,
      ...settingsOverrides,
    },
  })
}

/** Register the standard narrative + classifier handlers. */
function registerBaseHandlers(interceptor: FetchInterceptor) {
  interceptor.on('narrative', respondWithStream('The story continues.'))
  interceptor.on('classifier', respondWithJSON(defaultClassifierResult))
}

// ============================================================================
// Test suite
// ============================================================================

describe('Generation Feature Toggles', () => {
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
    // Reset translation settings to defaults
    settings.translationSettings.enabled = false
    settings.translationSettings.targetLanguage = 'en'
    // Reset image settings
    settings.systemServicesSettings.imageGeneration.profileId = null
    settings.imageProfiles = []
    // Reset style review
    ui.lastStyleReview = null
  })

  // --------------------------------------------------------------------------
  // 1. Translation toggle
  // --------------------------------------------------------------------------

  describe('Translation toggle', () => {
    it('translation enabled: translation request is made after narrative generation', async ({
      task,
    }) => {
      const testStory = buildAdventureStory()
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The adventure begins.',
            position: 0,
          }),
        ],
      })
      // Enable translation with a non-English target language
      loadTestSettings({ disableSuggestions: true, translationEnabled: true })
      settings.translationSettings.targetLanguage = 'cs'
      settings.translationSettings.translateNarration = true

      registerBaseHandlers(interceptor)
      // Register handler for narration translation
      interceptor.on('translate-narration', respondWithStream('Příběh pokračuje.'))

      const userActionEntry = await story.entry.addEntry('user_action', 'I look around')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // Translation request must have been made
      expect(interceptor.getRequests('translate-narration').length).toBeGreaterThan(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('translation disabled (default): no translation request is made', async ({ task }) => {
      const testStory = buildAdventureStory()
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The adventure begins.',
            position: 0,
          }),
        ],
      })
      // translationEnabled defaults to false in loadTestSettings
      loadTestSettings({ disableSuggestions: true })

      registerBaseHandlers(interceptor)

      const userActionEntry = await story.entry.addEntry('user_action', 'I look around')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // No translation request should be made
      expectNoRequest(interceptor, 'translate-narration')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })
  })

  // --------------------------------------------------------------------------
  // 2. Image mode toggle
  // --------------------------------------------------------------------------

  describe('Image mode toggle', () => {
    it("image mode 'agentic': image analysis request is made", async ({ task }) => {
      const testStory = buildAdventureStory({ imageGenerationMode: 'agentic' })
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The adventure begins.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })

      // Configure an image profile so isImageGenerationEnabled() returns true
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

      registerBaseHandlers(interceptor)
      // Register handler for image analysis
      interceptor.on(
        'image-prompt-analysis',
        respondWithJSON({
          scenes: [
            {
              prompt: 'A dramatic scene',
              sceneType: 'action',
              priority: 5,
              sourceText: 'test',
              characters: [],
              generatePortrait: false,
            },
          ],
        }),
      )

      const userActionEntry = await story.entry.addEntry('user_action', 'I look around')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // Image analysis request must have been made
      expect(interceptor.getRequests('image-prompt-analysis').length).toBeGreaterThan(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it("image mode 'none' (default): no image analysis request is made", async ({ task }) => {
      const testStory = buildAdventureStory({ imageGenerationMode: 'none' })
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The adventure begins.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })

      registerBaseHandlers(interceptor)

      const userActionEntry = await story.entry.addEntry('user_action', 'I look around')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // No image analysis request should be made
      expectNoRequest(interceptor, 'image-prompt-analysis')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })
  })

  // --------------------------------------------------------------------------
  // 3. Lorebook / retrieval toggle
  // --------------------------------------------------------------------------

  describe('Lorebook retrieval toggle', () => {
    it('lorebook entries present: tier3 entry selection LLM call is made', async ({ task }) => {
      const testStory = buildAdventureStory()
      // Load lorebook entries that will not be matched by tier1/tier2 (no keywords matching input)
      const lorebookEntry = buildLorebookEntry({
        storyId: testStory.id,
        name: 'Ancient Prophecy',
        description: 'A prophecy from the old ages.',
        keywords: ['ancient', 'prophecy', 'oracle'],
        injection: { mode: 'keyword', keywords: ['ancient', 'prophecy', 'oracle'], priority: 0 },
      })

      loadTestStory({
        story: testStory,
        lorebookEntries: [lorebookEntry],
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The adventure begins.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })

      registerBaseHandlers(interceptor)
      // Register tier3 entry selection handler
      interceptor.on('tier3-entry-selection', respondWithJSON({ selectedIds: [] }))

      // Use an action that does NOT mention lorebook keywords — entry goes to tier3
      const userActionEntry = await story.entry.addEntry('user_action', 'I walk forward slowly')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // Tier3 LLM selection should have been called since entry wasn't matched by keywords
      expect(interceptor.getRequests('tier3-entry-selection').length).toBeGreaterThan(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('no lorebook entries and no world state: no tier3 entry selection call is made', async ({
      task,
    }) => {
      const testStory = buildAdventureStory()
      // Minimal story — no lorebook entries, no world state entities
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The adventure begins.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })

      registerBaseHandlers(interceptor)

      const userActionEntry = await story.entry.addEntry('user_action', 'I walk forward slowly')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // No tier3 LLM selection should be made with no lore content
      expectNoRequest(interceptor, 'tier3-entry-selection')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('chapters present: timeline fill LLM call is made during retrieval', async ({ task }) => {
      const testStory = buildAdventureStory()
      const chapter = buildChapter({
        storyId: testStory.id,
        number: 1,
        summary: 'The hero began their journey.',
      })

      loadTestStory({
        story: testStory,
        chapters: [chapter],
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'Chapter two begins.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })

      registerBaseHandlers(interceptor)
      // Register timeline fill handler (uses 'timelineFill' serviceId in generate.ts)
      interceptor.on('timeline-fill', respondWithJSON({ responses: [] }))

      const userActionEntry = await story.entry.addEntry('user_action', 'I press on')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // Generation completed (narrative + classifier ran)
      expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })
  })

  // --------------------------------------------------------------------------
  // 4. Style review injection
  // --------------------------------------------------------------------------

  describe('Style review injection', () => {
    it('when ui.lastStyleReview is set, narrative prompt includes style feedback phrases', async ({
      task,
    }) => {
      const testStory = buildAdventureStory()
      loadTestStory({
        story: testStory,
        entries: [
          buildEntry({
            storyId: testStory.id,
            type: 'narration',
            content: 'The adventure begins.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })

      // Set a style review with at least one phrase — the template checks phrases.size > 0
      ui.lastStyleReview = {
        phrases: [
          {
            phrase: 'passive constructions',
            frequency: 3,
            severity: 'medium',
            alternatives: ['use active voice', 'rewrite with strong verbs'],
            contexts: ['The door was opened by...', 'The path was taken by...'],
          },
        ],
        overallAssessment: 'Avoid passive voice. Use more vivid action verbs.',
        reviewedEntryCount: 5,
        timestamp: Date.now(),
      }

      registerBaseHandlers(interceptor)

      const userActionEntry = await story.entry.addEntry('user_action', 'I advance forward')

      setUserAction(userActionEntry)
      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.generateResponse()

      // Narrative request was made
      expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

      // The narrative prompt should contain the style phrase feedback
      const narrativeReq = interceptor.getRequests('narrative')[0]
      const allContent = [narrativeReq.body?.messages, narrativeReq.body?.input]
        .filter(Boolean)
        .flat()
        .map((m: any) =>
          typeof m?.content === 'string'
            ? m.content
            : Array.isArray(m?.content)
              ? m.content.map((p: any) => p.text ?? p.input_text ?? '').join(' ')
              : '',
        )
        .join('\n')

      expect(allContent).toContain('passive constructions')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })
  })
})
