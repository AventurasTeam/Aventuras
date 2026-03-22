/**
 * Pipeline Smoke Test
 *
 * Exercises GenerationPipeline directly with real stores + fetch interception.
 * Establishes a baseline BEFORE the ActionInputController extraction.
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
import { FetchInterceptor, respondWithStream, respondWithToolCall } from './utils/FetchInterceptor'
import { createDatabaseMock } from './utils/databaseMock'
import { GenerationPipeline } from '$lib/services/generation'
import type { GenerationEvent } from '$lib/services/generation'
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

describe('GenerationPipeline smoke test', () => {
  let interceptor: FetchInterceptor
  let dbMock: ReturnType<typeof createDatabaseMock>

  beforeEach(() => {
    // Create and install database mock
    dbMock = createDatabaseMock()
    dbMockRef.current = dbMock

    // Create and install fetch interceptor
    interceptor = new FetchInterceptor()
    interceptor.install()
    interceptorRef.current = interceptor

    // Set up store state
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
      characters: [buildCharacter({ storyId: testStory.id, name: 'Hero', relationship: 'self' })],
      entries: [
        buildEntry({
          storyId: testStory.id,
          type: 'narration',
          content: 'You stand at the entrance of a dark cave.',
          position: 0,
        }),
      ],
    })

    loadTestSettings({ disableSuggestions: true })

    // Set up generation context (normally done by generateResponse)
    story.generationContext.clearIntermediates()
    story.generationContext.userAction = {
      entryId: 'test-user-action-id',
      content: 'I enter the cave',
      rawInput: 'I enter the cave',
    }
    story.generationContext.narrationEntryId = crypto.randomUUID()
    story.generationContext.abortSignal = new AbortController().signal
    story.generationContext.rawInput = 'I enter the cave'
    story.generationContext.actionType = 'do'
    story.generationContext.wasRawActionChoice = false
    story.generationContext.styleReview = null
    story.generationContext.activationTracker = null
  })

  afterEach(() => {
    interceptor.restore()
    clearTestStory()
  })

  it('runs the pipeline and yields narrative + classification events', async ({ task }) => {
    const narrativeText = 'The darkness envelops you as you step inside the cave.'

    // Register fetch handlers for narrative (streaming) and classifier (tool call)
    interceptor.on('narrative', respondWithStream(narrativeText))
    interceptor.on(
      'classifier',
      respondWithToolCall('classifyNarrative', {
        scene: {
          presentCharacterNames: ['Hero'],
          currentLocationName: 'Dark Cave',
          currentTime: null,
          elapsedTime: null,
        },
        entryUpdates: {
          newCharacters: [],
          updatedCharacters: [],
          newLocations: [{ name: 'Dark Cave', description: 'A deep, dark cavern.' }],
          newItems: [],
          newStoryBeats: [],
        },
      }),
    )

    const tracer = createAutoTracer(getStoreState)
    interceptor.connectTracer(tracer)

    // Run the pipeline
    const pipeline = new GenerationPipeline()
    const events: GenerationEvent[] = []

    for await (const event of pipeline.execute()) {
      events.push(event)
    }

    // Assert: we got the expected event sequence
    const eventTypes = events.map((e) => e.type)

    // Retrieval phase
    expect(eventTypes).toContain('phase_start')
    expect(events.some((e) => e.type === 'phase_start' && e.phase === 'retrieval')).toBe(true)
    expect(events.some((e) => e.type === 'phase_complete' && e.phase === 'retrieval')).toBe(true)

    // Narrative phase
    expect(events.some((e) => e.type === 'phase_start' && e.phase === 'narrative')).toBe(true)
    expect(eventTypes).toContain('narrative_chunk')
    expect(events.some((e) => e.type === 'phase_complete' && e.phase === 'narrative')).toBe(true)

    // Classification phase
    expect(events.some((e) => e.type === 'phase_start' && e.phase === 'classification')).toBe(true)
    expect(events.some((e) => e.type === 'classification_complete')).toBe(true)

    // Verify narrative content was captured
    const chunks = events.filter((e) => e.type === 'narrative_chunk')
    const fullNarrative = chunks
      .map((e) => (e.type === 'narrative_chunk' ? e.content : ''))
      .join('')
    expect(fullNarrative).toBe(narrativeText)

    // Verify the fetch interceptor captured the narrative request
    const narrativeRequests = interceptor.getRequests('narrative')
    expect(narrativeRequests.length).toBeGreaterThan(0)

    tracer.finalize()
    ;(task.meta as any).traceData = tracer.export()
  })

  it('handles abort correctly', async ({ task }) => {
    const abortController = new AbortController()
    story.generationContext.abortSignal = abortController.signal

    interceptor.on('narrative', respondWithStream('Some text that should not complete'))

    const tracer = createAutoTracer(getStoreState)
    interceptor.connectTracer(tracer)

    // Abort immediately
    abortController.abort()

    const pipeline = new GenerationPipeline()
    const events: GenerationEvent[] = []

    for await (const event of pipeline.execute()) {
      events.push(event)
    }

    // The pipeline should have completed retrieval then aborted
    expect(events.some((e) => e.type === 'phase_start' && e.phase === 'retrieval')).toBe(true)
    // Should NOT have a full narrative completion
    const narrativeComplete = events.find(
      (e) => e.type === 'phase_complete' && e.phase === 'narrative',
    )
    expect(narrativeComplete).toBeUndefined()

    tracer.finalize()
    ;(task.meta as any).traceData = tracer.export()
  })
})
