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
import { loadTestStory, loadTestSettings, clearTestStory } from './utils/storeHydration'
import { buildStory, buildEntry } from '$test/factories'
import { FetchInterceptor, respondWithStream, respondWithJSON } from './utils/FetchInterceptor'
import { createDatabaseMock } from './utils/databaseMock'
import type { DatabaseMock } from './utils/databaseMock'
import {
  ActionInputController,
  type ActionInputCallbacks,
} from '$lib/services/generation/ActionInputController'
import type { RetryBackupData } from '$lib/services/generation/RetryService'

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
    it('no-op when getLastGenerationError returns null', async () => {
      setupAdventureStory()

      const callbacks = buildMockCallbacks()
      // getLastGenerationError returns null by default
      const controller = new ActionInputController(callbacks)

      await controller.handleRetry()

      // No narrative request should have been made
      expect(interceptor.getRequests('narrative')).toHaveLength(0)
      expect(callbacks.clearGenerationError).not.toHaveBeenCalled()
    })

    it('clears error entry and retries generation on error entry found', async () => {
      const testStory = setupAdventureStory()

      // Add a user_action entry representing a prior user action
      const userActionEntry = await story.entry.addEntry('user_action', 'I move forward')

      // Add a system error entry that would have been created by a failed generation
      const errorEntry = await story.entry.addEntry('system', 'Generation failed: some AI error')

      // Verify both entries exist
      expect(story.entry.entries.find((e) => e.id === userActionEntry.id)).toBeDefined()
      expect(story.entry.entries.find((e) => e.id === errorEntry.id)).toBeDefined()

      // Set up working handlers for the retry
      interceptor.on('narrative', respondWithStream('You move forward carefully.'))
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

      const callbacks = buildMockCallbacks()
      // Make getLastGenerationError return an error pointing to the entries we set up
      callbacks.getLastGenerationError = vi.fn().mockReturnValue({
        message: 'some AI error',
        errorEntryId: errorEntry.id,
        userActionEntryId: userActionEntry.id,
        timestamp: Date.now(),
      })

      const controller = new ActionInputController(callbacks)
      await controller.handleRetry()

      // clearGenerationError was called
      expect(callbacks.clearGenerationError).toHaveBeenCalled()

      // A new narrative request was made
      expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

      // endStreaming and setGenerating(false) are always called (in finally block)
      expect(callbacks.endStreaming).toHaveBeenCalled()
      expect(callbacks.setGenerating).toHaveBeenCalledWith(false)

      // emitNarrativeResponse was called (generation succeeded)
      expect(callbacks.emitNarrativeResponse).toHaveBeenCalledWith(
        expect.any(String),
        'You move forward carefully.',
      )
    })

    it('clears error and no-ops when userActionEntry not found', async () => {
      setupAdventureStory()

      const callbacks = buildMockCallbacks()
      // Error references a non-existent user action entry ID
      callbacks.getLastGenerationError = vi.fn().mockReturnValue({
        message: 'some AI error',
        errorEntryId: 'fake-error-entry-id',
        userActionEntryId: 'non-existent-user-action-id',
        timestamp: Date.now(),
      })

      const controller = new ActionInputController(callbacks)
      await controller.handleRetry()

      // clearGenerationError is called even though entry not found
      expect(callbacks.clearGenerationError).toHaveBeenCalled()

      // No narrative request should be made since user action wasn't found
      expect(interceptor.getRequests('narrative')).toHaveLength(0)
    })

    it('creates error entry and calls setGenerationError when narrative fails', async () => {
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

      const callbacks = buildMockCallbacks()
      callbacks.getLastGenerationError = vi.fn().mockReturnValue({
        message: 'previous error',
        errorEntryId: fakeErrorEntry.id,
        userActionEntryId: userActionEntry.id,
        timestamp: Date.now(),
      })

      const controller = new ActionInputController(callbacks)
      await controller.handleRetry()

      // setGenerationError was called because the retry also failed
      expect(callbacks.setGenerationError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // 2. Stop generation (handleStopGeneration)
  // --------------------------------------------------------------------------

  describe('handleStopGeneration', () => {
    it('returns empty object when isRetryingLastMessage is true', async () => {
      setupAdventureStory()

      const callbacks = buildMockCallbacks()
      callbacks.isRetryingLastMessage = vi.fn().mockReturnValue(true)

      const controller = new ActionInputController(callbacks)
      const result = await controller.handleStopGeneration()

      expect(result).toEqual({})
    })

    it('returns empty object when no backup exists', async () => {
      setupAdventureStory()

      const callbacks = buildMockCallbacks()
      callbacks.getRetryBackup = vi.fn().mockReturnValue(null)

      const controller = new ActionInputController(callbacks)
      const result = await controller.handleStopGeneration()

      expect(result).toEqual({})
      // setGenerating(false) is called
      expect(callbacks.setGenerating).toHaveBeenCalledWith(false)
      // endStreaming is called
      expect(callbacks.endStreaming).toHaveBeenCalled()
    })

    it('returns empty object and clears backup when backup storyId does not match', async () => {
      const testStory = setupAdventureStory()

      const callbacks = buildMockCallbacks()
      // Backup for a different story
      const backup = buildRetryBackup('different-story-id')
      callbacks.getRetryBackup = vi.fn().mockReturnValue(backup)

      const controller = new ActionInputController(callbacks)
      const result = await controller.handleStopGeneration()

      expect(result).toEqual({})
      // clearRetryBackup should be called to discard the stale backup
      expect(callbacks.clearRetryBackup).toHaveBeenCalled()
    })

    it('restores state from backup and returns restored values', async () => {
      const testStory = setupAdventureStory()

      const callbacks = buildMockCallbacks()
      const backup = buildRetryBackup(testStory.id, {
        userActionContent: 'I run away',
        rawInput: 'run away',
        actionType: 'do',
        wasRawActionChoice: false,
        hasFullState: true,
        entries: [...story.entry.entries],
        entryCountBeforeAction: story.entry.entries.length,
      })
      callbacks.getRetryBackup = vi.fn().mockReturnValue(backup)

      // Set up the abort controller state as if generation is in progress
      const controller = new ActionInputController(callbacks)
      controller.stopRequested = false
      controller.activeAbortController = new AbortController()

      // Call handleStopGeneration while "generating"
      const result = await controller.handleStopGeneration()

      // Should call abort
      expect(callbacks.setGenerating).toHaveBeenCalledWith(false)
      expect(callbacks.endStreaming).toHaveBeenCalled()

      // clearRetryBackup(true) is called at end of stop flow
      expect(callbacks.clearRetryBackup).toHaveBeenCalledWith(true)

      // Restored values should reflect the backup
      expect(result.restoredRawInput).toBe('run away')
      expect(result.restoredActionType).toBe('do')
      expect(result.restoredWasRawActionChoice).toBe(false)
    })

    it('fires abort signal when stopRequested is set', async () => {
      const testStory = setupAdventureStory()

      // We need to intercept the abort. Capture the abort controller.
      let capturedAbortController: AbortController | null = null

      const callbacks = buildMockCallbacks()
      const backup = buildRetryBackup(testStory.id, {
        hasFullState: true,
        entries: [...story.entry.entries],
        entryCountBeforeAction: story.entry.entries.length,
      })
      callbacks.getRetryBackup = vi.fn().mockReturnValue(backup)

      const controller = new ActionInputController(callbacks)

      // Simulate an in-flight abort controller
      const abortController = new AbortController()
      controller.activeAbortController = abortController
      capturedAbortController = abortController

      const abortSpy = vi.spyOn(abortController, 'abort')

      await controller.handleStopGeneration()

      expect(abortSpy).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // 3. Retry last message (handleRetryLastMessage)
  // --------------------------------------------------------------------------

  describe('handleRetryLastMessage', () => {
    it('no-op when getRetryBackup returns null', async () => {
      setupAdventureStory()

      const callbacks = buildMockCallbacks()
      callbacks.getRetryBackup = vi.fn().mockReturnValue(null)

      const controller = new ActionInputController(callbacks)
      await controller.handleRetryLastMessage()

      // No narrative request should be made
      expect(interceptor.getRequests('narrative')).toHaveLength(0)
    })

    it('clears backup and no-ops when backup storyId does not match current story', async () => {
      setupAdventureStory()

      const callbacks = buildMockCallbacks()
      const backup = buildRetryBackup('different-story-id')
      callbacks.getRetryBackup = vi.fn().mockReturnValue(backup)

      const controller = new ActionInputController(callbacks)
      await controller.handleRetryLastMessage()

      // clearRetryBackup(false) is called (not clearing from DB)
      expect(callbacks.clearRetryBackup).toHaveBeenCalledWith(false)

      // No narrative request should be made
      expect(interceptor.getRequests('narrative')).toHaveLength(0)
    })

    it('rolls back state and creates new user_action entry and new narrative request', async () => {
      const testStory = setupAdventureStory()

      // Pre-populate entries as if a previous generation happened:
      // 0: narration (initial)
      // 1: user_action
      // 2: narration (the one we want to retry)
      const initialNarration = story.entry.entries[0]
      const userActionEntry = await story.entry.addEntry('user_action', 'I walk forward')
      const narratedEntry = await story.entry.addEntry('narration', 'You walk forward.')

      // Set up handlers for the new generation
      interceptor.on('narrative', respondWithStream('You stride confidently forward.'))
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

      const callbacks = buildMockCallbacks()

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
      callbacks.getRetryBackup = vi.fn().mockReturnValue(backup)

      const controller = new ActionInputController(callbacks)
      await controller.handleRetryLastMessage()

      // A new narrative request was made (regeneration happened)
      expect(interceptor.getRequests('narrative').length).toBeGreaterThan(0)

      // emitUserInput was called with the original user action content
      expect(callbacks.emitUserInput).toHaveBeenCalledWith('I walk forward', 'do')

      // setRetryingLastMessage was called with true then false
      expect(callbacks.setRetryingLastMessage).toHaveBeenCalledWith(true)
      expect(callbacks.setRetryingLastMessage).toHaveBeenCalledWith(false)

      // clearGenerationError was called as part of cleanup
      expect(callbacks.clearGenerationError).toHaveBeenCalled()

      // Generation succeeded
      expect(callbacks.emitNarrativeResponse).toHaveBeenCalledWith(
        expect.any(String),
        'You stride confidently forward.',
      )
    })

    it('sets retryingLastMessage to false even if generation throws', async () => {
      const testStory = setupAdventureStory()

      const initialNarration = story.entry.entries[0]
      await story.entry.addEntry('user_action', 'I fail')

      // Register a handler that throws a network-level error so the pipeline fails fast
      interceptor.on('narrative', () => {
        throw new Error('Network connection lost')
      })
      interceptor.on('classifier', respondWithJSON(defaultClassifierResult))

      const callbacks = buildMockCallbacks()
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
      callbacks.getRetryBackup = vi.fn().mockReturnValue(backup)

      const controller = new ActionInputController(callbacks)
      await controller.handleRetryLastMessage()

      // setRetryingLastMessage(false) must be called in finally even on error
      expect(callbacks.setRetryingLastMessage).toHaveBeenCalledWith(false)
    })

    it('consults getRetryBackup callback, not store directly', async () => {
      const testStory = setupAdventureStory()

      const callbacks = buildMockCallbacks()
      const getRetryBackupSpy = vi.fn().mockReturnValue(null)
      callbacks.getRetryBackup = getRetryBackupSpy

      const controller = new ActionInputController(callbacks)
      await controller.handleRetryLastMessage()

      // Should have called getRetryBackup at least once
      expect(getRetryBackupSpy).toHaveBeenCalled()
    })
  })
})
