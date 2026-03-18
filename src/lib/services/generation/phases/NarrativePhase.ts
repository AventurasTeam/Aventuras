/**
 * NarrativePhase - Handles streaming narrative generation
 *
 * Responsibilities:
 * - Coordinate streaming narrative generation via AIService
 * - Yield narrative chunks as they arrive
 * - Handle abort signals properly
 * - Retry on empty responses (up to 3 attempts)
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  NarrativeChunkEvent,
  AbortedEvent,
  ErrorEvent,
  AgenticRetrievalFields,
} from '../types'
import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  MemoryConfig,
  Entry,
} from '$lib/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type { StreamChunk } from '$lib/services/ai/core/types'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'
import type { RetrievalResult } from '../types'
import { storyContext } from '$lib/stores/storyContext.svelte'
import { DEFAULT_MEMORY_CONFIG } from '$lib/services/ai/generation/MemoryService'

/** Local WorldState interface for streamNarrative callback — deleted from types.ts in Phase 23, Phase 25 removes this need */
interface WorldState {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  currentLocation?: Location
  chapters: Chapter[]
  memoryConfig: MemoryConfig
  lorebookEntries: Entry[]
}

const MAX_EMPTY_RESPONSE_RETRIES = 3

/** Dependencies for narrative phase - injected to avoid tight coupling */
export interface NarrativeDependencies {
  streamNarrative: (
    entries: StoryEntry[],
    worldState: WorldState,
    story: Story | null | undefined,
    useTieredContext: boolean,
    styleReview: StyleReviewResult | null | undefined,
    agenticRetrieval: AgenticRetrievalFields | null | undefined,
    signal: AbortSignal | undefined,
    timelineFillResult: RetrievalResult['timelineFillResult'],
    lorebookEntries: ContextLorebookEntry[],
  ) => AsyncIterable<StreamChunk>
}

/** Input for the narrative phase */
export interface NarrativeInput {
  styleReview: StyleReviewResult | null | undefined
}

/** Result from narrative phase */
export interface NarrativeResult {
  content: string
  reasoning: string
  chunkCount: number
}

/**
 * NarrativePhase service
 * Streams narrative generation, yielding chunks as they arrive.
 * Handles automatic retry on empty responses (up to 3 attempts).
 */
export class NarrativePhase {
  constructor(private deps: NarrativeDependencies) {}

  /** Execute the narrative phase - yields chunk events and phase events */
  async *execute(input: NarrativeInput): AsyncGenerator<GenerationEvent, NarrativeResult | null> {
    yield { type: 'phase_start', phase: 'narrative' } satisfies PhaseStartEvent

    const { styleReview } = input
    const visibleEntries = storyContext.visibleEntries
    const story = storyContext.currentStory
    const retrievalResult = storyContext.retrievalResult!
    const abortSignal = storyContext.abortSignal ?? undefined

    // Build WorldState object for the streamNarrative callback
    // Phase 25 will remove the need for this intermediate object
    const worldState: WorldState = {
      characters: storyContext.characters,
      locations: storyContext.locations,
      items: storyContext.items,
      storyBeats: storyContext.storyBeats,
      currentLocation: storyContext.currentLocation,
      chapters: storyContext.currentBranchChapters,
      memoryConfig: storyContext.currentStory?.memoryConfig ?? DEFAULT_MEMORY_CONFIG,
      lorebookEntries: storyContext.lorebookEntries,
    }

    let fullResponse = ''
    let fullReasoning = ''
    let chunkCount = 0
    let retryCount = 0

    while (retryCount < MAX_EMPTY_RESPONSE_RETRIES) {
      if (abortSignal?.aborted) {
        yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
        return null
      }

      fullResponse = ''
      fullReasoning = ''
      chunkCount = 0

      try {
        for await (const chunk of this.deps.streamNarrative(
          visibleEntries,
          worldState,
          story,
          true, // useTieredContext
          styleReview,
          retrievalResult.agenticRetrieval,
          abortSignal,
          retrievalResult.timelineFillResult,
          retrievalResult.lorebookEntries,
        )) {
          if (abortSignal?.aborted) {
            yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
            return null
          }

          chunkCount++

          // Accumulate content and reasoning
          if (chunk.content) {
            fullResponse += chunk.content
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning
          }

          // Yield chunk if there's any content or reasoning to display
          if (chunk.content || chunk.reasoning) {
            yield {
              type: 'narrative_chunk',
              content: chunk.content || '',
              reasoning: chunk.reasoning,
            } satisfies NarrativeChunkEvent
          }

          if (chunk.done) {
            break
          }
        }

        if (fullResponse.trim()) {
          break // Success
        }
        retryCount++
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
          return null
        }
        yield {
          type: 'error',
          phase: 'narrative',
          error: error instanceof Error ? error : new Error(String(error)),
          fatal: true,
        } satisfies ErrorEvent
        return null
      }
    }

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
      return null
    }

    if (!fullResponse.trim()) {
      yield {
        type: 'error',
        phase: 'narrative',
        error: new Error(`Empty response after ${MAX_EMPTY_RESPONSE_RETRIES} attempts`),
        fatal: true,
      } satisfies ErrorEvent
      return null
    }

    const result: NarrativeResult = {
      content: fullResponse,
      reasoning: fullReasoning,
      chunkCount,
    }

    yield {
      type: 'phase_complete',
      phase: 'narrative',
      result,
    } satisfies PhaseCompleteEvent

    // Write result to singleton before returning (only on success path)
    storyContext.narrativeResult = result

    return result
  }
}
