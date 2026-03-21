/**
 * BackgroundTaskCoordinator E2E Tests
 *
 * Tests for post-pipeline background tasks: style review, chapter creation,
 * and lore management. Uses real stores + fetch interception.
 *
 * NOTE: BackgroundTaskCoordinator.run() has a known production bug where
 * `story.chapter.addChapter.bind(story)` uses the wrong `this` context
 * (should be `.bind(story.chapter)`). As a result, addChapter() always throws
 * when called via the static run() method. Tests that require full chapter
 * creation (including lore management) use runBackgroundTasks() directly with
 * properly wired dependencies to work around this.
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
import { buildStory, buildEntry } from '$test/factories'
import { FetchInterceptor, respondWithJSON, respondWithToolCall } from './utils/FetchInterceptor'
import { createDatabaseMock } from './utils/databaseMock'
import {
  BackgroundTaskCoordinator,
  type BackgroundTaskDependencies,
  type BackgroundTaskInput,
} from '$lib/services/generation/BackgroundTaskCoordinator'
import { aiService } from '$lib/services/ai'
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

// ============================================================================
// Test data helpers
// ============================================================================

/** Chapter analysis result — no chapter needed. */
const chapterAnalysisNoChapter = {
  shouldCreateChapter: false,
  optimalEndIndex: 0,
  suggestedTitle: null,
  keywords: [],
  characters: [],
  locations: [],
  plotThreads: [],
  emotionalTone: 'neutral',
  significantEvents: [],
}

/** Chapter analysis result — chapter should be created at index 5. */
const chapterAnalysisCreateChapter = {
  shouldCreateChapter: true,
  optimalEndIndex: 5,
  suggestedTitle: 'A New Dawn',
  keywords: ['quest', 'adventure'],
  characters: ['Hero'],
  locations: ['Forest'],
  plotThreads: ['main quest'],
  emotionalTone: 'hopeful',
  significantEvents: ['Hero entered the forest'],
}

/** Chapter summarization response. */
const chapterSummaryResult = {
  title: 'A New Dawn',
  summary: 'The hero ventured into the forest on a new quest.',
  keywords: ['forest', 'quest'],
  characters: ['Hero'],
  locations: ['Forest'],
  plotThreads: ['main quest'],
  emotionalTone: 'hopeful',
}

/** Style review response. */
const styleReviewResult = {
  phrases: [],
  overallAssessment: 'No issues found.',
}

/**
 * Build a story with enough entries and a low tokenThreshold to trigger
 * chapter creation via BackgroundTaskCoordinator.run().
 *
 * countTokens is mocked to 100.
 * With chapterBuffer=2, tokenThreshold=500, and 7 entries:
 *   entries outside buffer = 7 - 2 = 5
 *   tokens outside buffer  = 5 × 100 = 500
 *   500 >= 500 → chapter analysis triggered
 */
function buildChapterReadyStory() {
  const testStory = buildStory({
    mode: 'adventure',
    settings: {
      pov: 'second',
      tense: 'past',
      imageGenerationMode: 'none',
      backgroundImagesEnabled: false,
    },
    memoryConfig: {
      tokenThreshold: 500,
      chapterBuffer: 2,
      autoSummarize: true,
      enableRetrieval: false,
      maxChaptersPerRetrieval: 3,
    },
  })

  const entries = Array.from({ length: 7 }, (_, i) =>
    buildEntry({
      storyId: testStory.id,
      type: 'narration',
      content: `Entry number ${i + 1} in the story.`,
      position: i,
    }),
  )

  return { testStory, entries }
}

/**
 * Build a BackgroundTaskInput wired to the real aiService (intercepted via
 * FetchInterceptor) but with stub callbacks for chapter/lore CRUD.
 * Bypasses the broken story.chapter.addChapter.bind(story) in the static run().
 */
function buildTestInput(storyId: string): {
  input: BackgroundTaskInput
  deps: BackgroundTaskDependencies
  addChapterMock: ReturnType<typeof vi.fn>
} {
  const addChapterMock = vi.fn().mockResolvedValue(undefined)

  const deps: BackgroundTaskDependencies = {
    chapterService: {
      analyzeForChapter: aiService.analyzeForChapter.bind(aiService),
      summarizeChapter: aiService.summarizeChapter.bind(aiService),
      getNextChapterNumber: vi.fn().mockResolvedValue(1),
      addChapter: addChapterMock,
    },
    loreManagement: {
      runLoreManagement: aiService.runLoreManagement.bind(aiService),
    },
    styleReview: { analyzeStyle: aiService.analyzeStyle.bind(aiService) },
  }

  const currentStory = story.currentStory!
  const input: BackgroundTaskInput = {
    styleReview: {
      storyId,
      entries: story.entry.entries,
      mode: currentStory.mode,
      pov: story.generationContext.pov,
      tense: story.generationContext.tense,
      enabled: settings.systemServicesSettings.styleReviewer.enabled,
      triggerInterval: settings.systemServicesSettings.styleReviewer.triggerInterval,
      currentCounter: ui.messagesSinceLastStyleReview,
      shouldIncrement: false,
      source: 'test',
    },
    styleReviewCallbacks: {
      incrementCounter: vi.fn(),
      setLoading: vi.fn(),
      setResult: vi.fn(),
    },
    chapterCheck: {
      storyId,
      currentBranchId: currentStory.currentBranchId,
      entries: story.entry.entries,
      lastChapterEndIndex: story.chapter.lastChapterEndIndex,
      tokensSinceLastChapter: story.generationContext.tokensSinceLastChapter,
      tokensOutsideBuffer: story.generationContext.tokensOutsideBuffer,
      messagesSinceLastChapter: story.chapter.messagesSinceLastChapter,
      memoryConfig: story.generationContext.memoryConfig,
      currentBranchChapters: story.chapter.currentBranchChapters,
      mode: currentStory.mode,
      pov: story.generationContext.pov,
      tense: story.generationContext.tense,
    },
    loreSession: {
      storyId,
      currentBranchId: currentStory.currentBranchId,
      lorebookEntries: story.lorebook.lorebookEntries,
      chapters: story.chapter.currentBranchChapters,
      mode: currentStory.mode,
      pov: story.generationContext.pov,
      tense: story.generationContext.tense,
    },
    loreCallbacks: {
      onCreateEntry: vi.fn().mockResolvedValue(undefined),
      onUpdateEntry: vi.fn().mockResolvedValue(undefined),
      onDeleteEntry: vi.fn().mockResolvedValue(undefined),
      onMergeEntries: vi.fn().mockResolvedValue(undefined),
    },
    loreUICallbacks: {
      onStart: vi.fn(),
      onProgress: vi.fn(),
      onComplete: vi.fn(),
    },
  }

  return { input, deps, addChapterMock }
}

// ============================================================================
// Test suite
// ============================================================================

describe('BackgroundTaskCoordinator E2E', () => {
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
    ui.messagesSinceLastStyleReview = 0
    settings.systemServicesSettings.styleReviewer.enabled = true
    settings.systemServicesSettings.styleReviewer.triggerInterval = 5
  })

  // --------------------------------------------------------------------------
  // 1. Style review
  // --------------------------------------------------------------------------

  describe('style review', () => {
    it('triggers style review when counter reaches triggerInterval', async ({ task }) => {
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

      // counter = 4, countStyleReview=true → effective = 5 = triggerInterval → fires
      settings.systemServicesSettings.styleReviewer.enabled = true
      settings.systemServicesSettings.styleReviewer.triggerInterval = 5
      ui.messagesSinceLastStyleReview = 4

      interceptor.on('style-reviewer', respondWithJSON(styleReviewResult))

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await BackgroundTaskCoordinator.run(true, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('style-reviewer').length).toBeGreaterThan(0)
    })

    it('skips style review when counter is below triggerInterval', async ({ task }) => {
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

      // counter = 0, countStyleReview=true → effective = 1 < 5 → skips
      settings.systemServicesSettings.styleReviewer.enabled = true
      settings.systemServicesSettings.styleReviewer.triggerInterval = 5
      ui.messagesSinceLastStyleReview = 0

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await BackgroundTaskCoordinator.run(true, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('style-reviewer').length).toBe(0)
    })

    it('skips style review when disabled', async ({ task }) => {
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

      settings.systemServicesSettings.styleReviewer.enabled = false
      ui.messagesSinceLastStyleReview = 100 // High counter but disabled

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await BackgroundTaskCoordinator.run(true, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('style-reviewer').length).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // 2. Chapter creation (via BackgroundTaskCoordinator.run())
  // --------------------------------------------------------------------------

  describe('chapter creation (via static run())', () => {
    it('fires chapter-analysis request when tokens exceed threshold', async ({ task }) => {
      const { testStory, entries } = buildChapterReadyStory()
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      interceptor.on('chapter-analysis', respondWithJSON(chapterAnalysisCreateChapter))
      interceptor.on('chapter-summarization', respondWithJSON(chapterSummaryResult))
      // Lore management fires after chapter creation — provide a no-op handler
      interceptor.on(
        'lore-management',
        respondWithToolCall('finish_lore_management', {
          summary: 'No changes.',
          entriesCreated: 0,
          entriesUpdated: 0,
          entriesDeleted: 0,
          entriesMerged: 0,
        }),
      )

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await BackgroundTaskCoordinator.run(false, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('chapter-analysis').length).toBeGreaterThan(0)
      expect(interceptor.getRequests('chapter-summarization').length).toBeGreaterThan(0)
    })

    it('skips chapter analysis when AI decides no chapter is needed', async ({ task }) => {
      const { testStory, entries } = buildChapterReadyStory()
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      interceptor.on('chapter-analysis', respondWithJSON(chapterAnalysisNoChapter))

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await BackgroundTaskCoordinator.run(false, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('chapter-analysis').length).toBeGreaterThan(0)
      expect(interceptor.getRequests('chapter-summarization').length).toBe(0)
    })

    it('skips chapter analysis when no entries are outside the buffer', async ({ task }) => {
      // chapterBuffer=10, only 3 entries → all inside buffer → tokensOutsideBuffer=0
      const testStory = buildStory({
        mode: 'adventure',
        settings: {
          pov: 'second',
          tense: 'past',
          imageGenerationMode: 'none',
          backgroundImagesEnabled: false,
        },
        memoryConfig: {
          tokenThreshold: 16000,
          chapterBuffer: 10,
          autoSummarize: true,
          enableRetrieval: false,
          maxChaptersPerRetrieval: 3,
        },
      })
      const entries = Array.from({ length: 3 }, (_, i) =>
        buildEntry({
          storyId: testStory.id,
          type: 'narration',
          content: `Entry ${i}`,
          position: i,
        }),
      )
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await BackgroundTaskCoordinator.run(false, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('chapter-analysis').length).toBe(0)
    })

    it('skips chapter creation when autoSummarize is disabled', async ({ task }) => {
      const testStory = buildStory({
        mode: 'adventure',
        settings: {
          pov: 'second',
          tense: 'past',
          imageGenerationMode: 'none',
          backgroundImagesEnabled: false,
        },
        memoryConfig: {
          tokenThreshold: 500,
          chapterBuffer: 2,
          autoSummarize: false, // Disabled
          enableRetrieval: false,
          maxChaptersPerRetrieval: 3,
        },
      })
      const entries = Array.from({ length: 7 }, (_, i) =>
        buildEntry({
          storyId: testStory.id,
          type: 'narration',
          content: `Entry ${i}`,
          position: i,
        }),
      )
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      // run() zeroes tokensOutsideBuffer when autoSummarize=false
      await BackgroundTaskCoordinator.run(false, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('chapter-analysis').length).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // 3. Full chapter + lore management pipeline (via runBackgroundTasks())
  //
  // Uses the instance method directly to avoid the binding bug in run().
  // Deps are constructed with properly bound methods.
  // --------------------------------------------------------------------------

  describe('chapter + lore management pipeline (via runBackgroundTasks())', () => {
    it('runs lore management when chapter creation triggers it', async ({ task }) => {
      const { testStory, entries } = buildChapterReadyStory()
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      const { input, deps, addChapterMock } = buildTestInput(testStory.id)

      interceptor.on('chapter-analysis', respondWithJSON(chapterAnalysisCreateChapter))
      interceptor.on('chapter-summarization', respondWithJSON(chapterSummaryResult))
      interceptor.on(
        'lore-management',
        respondWithToolCall('finish_lore_management', {
          summary: 'No changes needed.',
          entriesCreated: 0,
          entriesUpdated: 0,
          entriesDeleted: 0,
          entriesMerged: 0,
        }),
      )

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      const coordinator = new BackgroundTaskCoordinator(deps)
      const result = await coordinator.runBackgroundTasks(input)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(interceptor.getRequests('chapter-analysis').length).toBeGreaterThan(0)
      expect(interceptor.getRequests('chapter-summarization').length).toBeGreaterThan(0)
      expect(addChapterMock).toHaveBeenCalled()
      expect(result.chapterCreation.created).toBe(true)
      expect(result.chapterCreation.loreManagementTriggered).toBe(true)
      expect(interceptor.getRequests('lore-management').length).toBeGreaterThan(0)
    })

    it('skips lore management when chapter creation did not trigger it', async ({ task }) => {
      const { testStory, entries } = buildChapterReadyStory()
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      const { input, deps } = buildTestInput(testStory.id)

      interceptor.on('chapter-analysis', respondWithJSON(chapterAnalysisNoChapter))

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      const coordinator = new BackgroundTaskCoordinator(deps)
      const result = await coordinator.runBackgroundTasks(input)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      expect(result.chapterCreation.created).toBe(false)
      expect(result.chapterCreation.loreManagementTriggered).toBe(false)
      expect(interceptor.getRequests('lore-management').length).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // 4. Non-fatal failure handling
  //
  // The coordinator catches errors from each task independently so one failure
  // doesn't block subsequent tasks.
  // Uses 400 errors (non-retryable) to avoid AI SDK retry delays.
  // --------------------------------------------------------------------------

  describe('non-fatal failure handling', () => {
    it('completes without throwing when style review encounters a client error', async ({
      task,
    }) => {
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
            content: 'Begin.',
            position: 0,
          }),
        ],
      })
      loadTestSettings({ disableSuggestions: true })

      // Counter at trigger level so style review fires
      settings.systemServicesSettings.styleReviewer.enabled = true
      settings.systemServicesSettings.styleReviewer.triggerInterval = 5
      ui.messagesSinceLastStyleReview = 4

      // 400 = non-retryable client error (avoids AI SDK retry delays)
      interceptor.on(
        'style-reviewer',
        () => new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
      )

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await expect(BackgroundTaskCoordinator.run(true, 'new')).resolves.toBeUndefined()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('completes without throwing when chapter analysis encounters a client error', async ({
      task,
    }) => {
      const { testStory, entries } = buildChapterReadyStory()
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      // 400 = non-retryable
      interceptor.on(
        'chapter-analysis',
        () => new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
      )

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await expect(BackgroundTaskCoordinator.run(false, 'new')).resolves.toBeUndefined()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('completes without throwing when lore management encounters a client error', async ({
      task,
    }) => {
      const { testStory, entries } = buildChapterReadyStory()
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })
      settings.systemServicesSettings.styleReviewer.enabled = false

      const { input, deps } = buildTestInput(testStory.id)

      interceptor.on('chapter-analysis', respondWithJSON(chapterAnalysisCreateChapter))
      interceptor.on('chapter-summarization', respondWithJSON(chapterSummaryResult))
      // 400 = non-retryable
      interceptor.on(
        'lore-management',
        () => new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
      )

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      const coordinator = new BackgroundTaskCoordinator(deps)
      await expect(coordinator.runBackgroundTasks(input)).resolves.toBeDefined()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('continues to run chapter check even after style review failure', async ({ task }) => {
      const { testStory, entries } = buildChapterReadyStory()
      loadTestStory({ story: testStory, entries })
      loadTestSettings({ disableSuggestions: true })

      // Enable style review at trigger level so it fires and fails
      settings.systemServicesSettings.styleReviewer.enabled = true
      settings.systemServicesSettings.styleReviewer.triggerInterval = 5
      ui.messagesSinceLastStyleReview = 4

      // 400 = non-retryable, so no retry delays
      interceptor.on(
        'style-reviewer',
        () => new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
      )
      // Chapter analysis fires and succeeds
      interceptor.on('chapter-analysis', respondWithJSON(chapterAnalysisNoChapter))

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await BackgroundTaskCoordinator.run(true, 'new')

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()

      // Despite style review failure, chapter analysis still ran
      expect(interceptor.getRequests('chapter-analysis').length).toBeGreaterThan(0)
    })
  })
})
