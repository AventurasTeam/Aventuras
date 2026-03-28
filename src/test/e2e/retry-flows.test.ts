/**
 * Retry Flow Tests
 *
 * E2E tests for stop, retry, and retry-last-message flows in ActionInputController.
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
import { ui } from '$lib/stores/ui.svelte'
import { loadTestStory, loadTestSettings, clearTestStory } from './utils/storeHydration'
import { buildStory, buildEntry } from '$test/factories'
import { FetchInterceptor, respondWithStream, respondWithJSON } from './utils/FetchInterceptor'
import { createDatabaseMock } from './utils/databaseMock'
import type { DatabaseMock } from './utils/databaseMock'
import { ActionInputController } from '$lib/services/generation/ActionInputController'
import type { RetryBackupData } from '$lib/services/generation/RetryService'
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
 * Build a minimal RetryBackupData for use in stop/retry-last-message tests.
 */
function buildRetryBackup(
  storyId: string,
  overrides: Partial<RetryBackupData> = {},
): RetryBackupData {
  return {
    storyId,
    timestamp: Date.now(),
    entries: [],
    characters: [],
    locations: [],
    items: [],
    storyBeats: [],
    embeddedImages: [],
    userActionContent: 'I walk forward',
    rawInput: 'walk forward',
    actionType: 'do',
    wasRawActionChoice: false,
    activationData: {},
    storyPosition: 0,
    entryCountBeforeAction: 0,
    hasFullState: true,
    hasEntityIds: false,
    characterIds: [],
    locationIds: [],
    itemIds: [],
    storyBeatIds: [],
    timeTracker: null,
    ...overrides,
  }
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
        content: 'You stand at a crossroads.',
        position: 0,
      }),
    ],
  })
  loadTestSettings({ disableSuggestions: true })
  return testStory
}

// ============================================================================
// Test suite
// ============================================================================

describe('Retry Flows — ActionInputController E2E', () => {
  let interceptor: FetchInterceptor
  let dbMock: DatabaseMock

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
  // 1. Error retry (handleRetry)
  // --------------------------------------------------------------------------

  describe('handleRetry', () => {
    it('no-op when lastGenerationError is null', async ({ task }) => {
      setupAdventureStory()

      const controller = new ActionInputController()
      const clearGenerationErrorSpy = vi.spyOn(ui, 'clearGenerationError')

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetry()

      // No narrative request should have been made
      expect(interceptor.getRequests('narrative')).toHaveLength(0)
      expect(clearGenerationErrorSpy).not.toHaveBeenCalled()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('clears error entry and retries generation on error entry found', async ({ task }) => {
      setupAdventureStory()

      // Add a user_action entry representing a prior user action
      const userActionEntry = await story.entry.addEntry('user_action', 'I move forward')

      // Add a system error entry that would have been created by a failed generation
      const errorEntry = await story.entry.addEntry('system', 'Generation failed: some AI error')

      // Verify both entries exist
      expect(story.entry.rawEntries.find((e) => e.id === userActionEntry.id)).toBeDefined()
      expect(story.entry.rawEntries.find((e) => e.id === errorEntry.id)).toBeDefined()

      // Set up working handlers for the retry
      interceptor.on('narrative', respondWithStream('You move forward carefully.'))
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

      // Set the generation error in ui store
      ui.setGenerationError({
        message: 'some AI error',
        errorEntryId: errorEntry.id,
        userActionEntryId: userActionEntry.id,
        timestamp: Date.now(),
      })

      const controller = new ActionInputController()
      const clearGenerationErrorSpy = vi.spyOn(ui, 'clearGenerationError')
      const endStreamingSpy = vi.spyOn(ui, 'endStreaming')
      const setGeneratingSpy = vi.spyOn(ui, 'setGenerating')

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetry()

      // clearGenerationError was called
      expect(clearGenerationErrorSpy).toHaveBeenCalled()

      // A new narrative request was made
      expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

      // endStreaming and setGenerating(false) are always called (in finally block)
      expect(endStreamingSpy).toHaveBeenCalled()
      expect(setGeneratingSpy).toHaveBeenCalledWith(false)

      // Narration entry was added
      const narrationEntry = story.entry.rawEntries.find(
        (e) => e.type === 'narration' && e.content === 'You move forward carefully.',
      )
      expect(narrationEntry).toBeDefined()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('clears error and no-ops when userActionEntry not found', async ({ task }) => {
      setupAdventureStory()

      // Error references a non-existent user action entry ID
      ui.setGenerationError({
        message: 'some AI error',
        errorEntryId: 'fake-error-entry-id',
        userActionEntryId: 'non-existent-user-action-id',
        timestamp: Date.now(),
      })

      const controller = new ActionInputController()
      const clearGenerationErrorSpy = vi.spyOn(ui, 'clearGenerationError')

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetry()

      // clearGenerationError is called even though entry not found
      expect(clearGenerationErrorSpy).toHaveBeenCalled()

      // No narrative request should be made since user action wasn't found
      expect(interceptor.getRequests('narrative')).toHaveLength(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('creates error entry and calls setGenerationError when narrative fails', async ({
      task,
    }) => {
      setupAdventureStory()

      const userActionEntry = await story.entry.addEntry('user_action', 'I try something risky')
      const fakeErrorEntry = await story.entry.addEntry(
        'system',
        'Generation failed: previous error',
      )

      // Register a handler that throws a network-level error — this causes NarrativePhase
      // to emit a fatal error event immediately (no retry cycle)
      interceptor.on('narrative', () => {
        throw new Error('Network connection lost')
      })
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

      // Set the generation error in ui store
      ui.setGenerationError({
        message: 'previous error',
        errorEntryId: fakeErrorEntry.id,
        userActionEntryId: userActionEntry.id,
        timestamp: Date.now(),
      })

      const controller = new ActionInputController()
      const setGenerationErrorSpy = vi.spyOn(ui, 'setGenerationError')

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetry()

      // setGenerationError was called because the retry also failed
      expect(setGenerationErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) }),
      )

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })
  })

  // --------------------------------------------------------------------------
  // 2. Stop generation (handleStopGeneration)
  // --------------------------------------------------------------------------

  describe('handleStopGeneration', () => {
    it('returns empty object when isRetryingLastMessage is true', async ({ task }) => {
      setupAdventureStory()

      ui.setRetryingLastMessage(true)

      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      const result = await controller.handleStopGeneration()

      expect(result).toEqual({})

      ui.setRetryingLastMessage(false) // cleanup

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('returns empty object when no backup exists', async ({ task }) => {
      setupAdventureStory()

      const controller = new ActionInputController()
      const setGeneratingSpy = vi.spyOn(ui, 'setGenerating')
      const endStreamingSpy = vi.spyOn(ui, 'endStreaming')

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      const result = await controller.handleStopGeneration()

      expect(result).toEqual({})
      // setGenerating(false) is called
      expect(setGeneratingSpy).toHaveBeenCalledWith(false)
      // endStreaming is called
      expect(endStreamingSpy).toHaveBeenCalled()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('returns empty object and clears backup when backup storyId does not match', async ({
      task,
    }) => {
      setupAdventureStory()

      // Backup for a different story
      const backup = buildRetryBackup('different-story-id')
      vi.spyOn(ui, 'retryBackup', 'get').mockReturnValue(backup as any)
      const clearRetryBackupSpy = vi.spyOn(ui, 'clearRetryBackup')

      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      const result = await controller.handleStopGeneration()

      expect(result).toEqual({})
      // clearRetryBackup should be called to discard the stale backup
      expect(clearRetryBackupSpy).toHaveBeenCalled()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('restores state from backup and returns restored values', async ({ task }) => {
      const testStory = setupAdventureStory()

      const backup = buildRetryBackup(testStory.id, {
        userActionContent: 'I run away',
        rawInput: 'run away',
        actionType: 'do',
        wasRawActionChoice: false,
        hasFullState: true,
        entries: [...story.entry.rawEntries],
        entryCountBeforeAction: story.entry.rawEntries.length,
      })
      vi.spyOn(ui, 'retryBackup', 'get').mockReturnValue(backup as any)
      const setGeneratingSpy = vi.spyOn(ui, 'setGenerating')
      const endStreamingSpy = vi.spyOn(ui, 'endStreaming')
      const clearRetryBackupSpy = vi.spyOn(ui, 'clearRetryBackup')

      // Set up the abort controller state as if generation is in progress
      const controller = new ActionInputController()
      controller.stopRequested = false
      controller.activeAbortController = new AbortController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      // Call handleStopGeneration while "generating"
      const result = await controller.handleStopGeneration()

      // Should call abort
      expect(setGeneratingSpy).toHaveBeenCalledWith(false)
      expect(endStreamingSpy).toHaveBeenCalled()

      // clearRetryBackup(true) is called at end of stop flow
      expect(clearRetryBackupSpy).toHaveBeenCalledWith(true)

      // Restored values should reflect the backup
      expect(result.restoredRawInput).toBe('run away')
      expect(result.restoredActionType).toBe('do')
      expect(result.restoredWasRawActionChoice).toBe(false)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('fires abort signal when stopRequested is set', async ({ task }) => {
      setupAdventureStory()

      const backup = buildRetryBackup(story.id!, {
        hasFullState: true,
        entries: [...story.entry.rawEntries],
        entryCountBeforeAction: story.entry.rawEntries.length,
      })
      vi.spyOn(ui, 'retryBackup', 'get').mockReturnValue(backup as any)

      const controller = new ActionInputController()

      // Simulate an in-flight abort controller
      const abortController = new AbortController()
      controller.activeAbortController = abortController

      const abortSpy = vi.spyOn(abortController, 'abort')

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleStopGeneration()

      expect(abortSpy).toHaveBeenCalled()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })
  })

  // --------------------------------------------------------------------------
  // 3. Retry last message (handleRetryLastMessage)
  // --------------------------------------------------------------------------

  describe('handleRetryLastMessage', () => {
    it('no-op when retryBackup is null', async ({ task }) => {
      setupAdventureStory()

      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetryLastMessage()

      // No narrative request should be made
      expect(interceptor.getRequests('narrative')).toHaveLength(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('clears backup and no-ops when backup storyId does not match current story', async ({
      task,
    }) => {
      setupAdventureStory()

      const backup = buildRetryBackup('different-story-id')
      vi.spyOn(ui, 'retryBackup', 'get').mockReturnValue(backup as any)
      const clearRetryBackupSpy = vi.spyOn(ui, 'clearRetryBackup')

      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetryLastMessage()

      // clearRetryBackup(false) is called (not clearing from DB)
      expect(clearRetryBackupSpy).toHaveBeenCalledWith(false)

      // No narrative request should be made
      expect(interceptor.getRequests('narrative')).toHaveLength(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('rolls back state and creates new user_action entry and new narrative request', async ({
      task,
    }) => {
      const testStory = setupAdventureStory()

      // Pre-populate entries as if a previous generation happened:
      // 0: narration (initial)
      // 1: user_action
      // 2: narration (the one we want to retry)
      const initialNarration = story.entry.rawEntries[0]
      await story.entry.addEntry('user_action', 'I walk forward')
      await story.entry.addEntry('narration', 'You walk forward.')

      // Set up handlers for the new generation
      interceptor.on('narrative', respondWithStream('You stride confidently forward.'))
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

      // Build backup that captures state before userActionEntry was added
      const backup = buildRetryBackup(testStory.id, {
        userActionContent: 'I walk forward',
        rawInput: 'walk forward',
        actionType: 'do',
        wasRawActionChoice: false,
        hasFullState: true,
        // Backup entries = only the initial narration (before user action)
        entries: [initialNarration],
        characters: [],
        locations: [],
        items: [],
        storyBeats: [],
        embeddedImages: [],
        entryCountBeforeAction: 1,
      })
      vi.spyOn(ui, 'retryBackup', 'get').mockReturnValue(backup as any)
      const setRetryingLastMessageSpy = vi.spyOn(ui, 'setRetryingLastMessage')
      const clearGenerationErrorSpy = vi.spyOn(ui, 'clearGenerationError')

      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetryLastMessage()

      // A new narrative request was made (regeneration happened)
      expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

      // setRetryingLastMessage was called with true then false
      expect(setRetryingLastMessageSpy).toHaveBeenCalledWith(true)
      expect(setRetryingLastMessageSpy).toHaveBeenCalledWith(false)

      // clearGenerationError was called as part of cleanup
      expect(clearGenerationErrorSpy).toHaveBeenCalled()

      // Narration entry was added
      const narrationEntry = story.entry.rawEntries.find(
        (e) => e.type === 'narration' && e.content === 'You stride confidently forward.',
      )
      expect(narrationEntry).toBeDefined()

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('sets retryingLastMessage to false even if generation throws', async ({ task }) => {
      const testStory = setupAdventureStory()

      const initialNarration = story.entry.rawEntries[0]
      await story.entry.addEntry('user_action', 'I fail')

      // Register a handler that throws a network-level error so the pipeline fails fast
      interceptor.on('narrative', () => {
        throw new Error('Network connection lost')
      })
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

      const backup = buildRetryBackup(testStory.id, {
        userActionContent: 'I fail',
        rawInput: 'fail',
        actionType: 'do',
        wasRawActionChoice: false,
        hasFullState: true,
        entries: [initialNarration],
        characters: [],
        locations: [],
        items: [],
        storyBeats: [],
        embeddedImages: [],
        entryCountBeforeAction: 1,
      })
      vi.spyOn(ui, 'retryBackup', 'get').mockReturnValue(backup as any)
      const setRetryingLastMessageSpy = vi.spyOn(ui, 'setRetryingLastMessage')

      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      await controller.handleRetryLastMessage()

      // setRetryingLastMessage(false) must be called in finally even on error
      expect(setRetryingLastMessageSpy).toHaveBeenCalledWith(false)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })

    it('reads retryBackup from ui store directly', async ({ task }) => {
      setupAdventureStory()

      const controller = new ActionInputController()

      const tracer = createAutoTracer(getStoreState)
      interceptor.connectTracer(tracer)

      // ui.retryBackup is null by default, so this should no-op
      await controller.handleRetryLastMessage()

      // No narrative request should be made
      expect(interceptor.getRequests('narrative')).toHaveLength(0)

      tracer.finalize()
      ;(task.meta as any).traceData = tracer.export()
    })
  })
})
