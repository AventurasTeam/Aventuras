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
  WorldState,
  RetrievalResult,
} from '../types'
import type { Story, StoryEntry } from '$lib/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type { StreamChunk } from '$lib/services/ai/core/types'
import { NO_ACTIVITY, type ActivityReporter } from '$lib/services/activity'

const MAX_EMPTY_RESPONSE_RETRIES = 3

/** Dependencies for narrative phase - injected to avoid tight coupling */
export interface NarrativeDependencies {
  /** Absent in tests and anywhere reporting is not wired; see NO_ACTIVITY. */
  activity?: ActivityReporter
  streamNarrative: (
    entries: StoryEntry[],
    worldState: WorldState,
    story: Story | null | undefined,
    styleReview: StyleReviewResult | null | undefined,
    retrievedContext: string | null | undefined,
    signal: AbortSignal | undefined,
    timelineFillResult: RetrievalResult['timelineFillResult'],
    worldStateBlock: string | null | undefined,
  ) => AsyncIterable<StreamChunk>
}

/** Input for the narrative phase */
export interface NarrativeInput {
  visibleEntries: StoryEntry[]
  worldState: WorldState
  story: Story | null | undefined
  retrievalResult: RetrievalResult
  styleReview: StyleReviewResult | null | undefined
  abortSignal?: AbortSignal
  /** Step this phase nests under. */
  activityParentId?: string | null
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

    const { visibleEntries, worldState, story, retrievalResult, styleReview, abortSignal } = input
    const activity = this.deps.activity ?? NO_ACTIVITY
    const narrativeStepId = activity.startStep('Narrative', { parentId: input.activityParentId })

    let fullResponse = ''
    let fullReasoning = ''
    let chunkCount = 0
    let retryCount = 0

    while (retryCount < MAX_EMPTY_RESPONSE_RETRIES) {
      if (abortSignal?.aborted) {
        activity.endStep(narrativeStepId, 'skipped')
        yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
        return null
      }

      fullResponse = ''
      fullReasoning = ''
      chunkCount = 0

      // An attempt is its own step: the loop is otherwise silent, so three empty responses
      // read as one long wait with nothing to show for it.
      const attemptId = activity.startStep(
        retryCount > 0 ? `Attempt ${retryCount + 1}` : 'Generating',
        { parentId: narrativeStepId, isLLM: true },
      )
      // Closed at the first chunk carrying anything, so the wait for the model is separable
      // from the time spent streaming.
      let waitId = activity.startStep('Waiting for model', { parentId: attemptId })

      try {
        for await (const chunk of this.deps.streamNarrative(
          visibleEntries,
          worldState,
          story,
          styleReview,
          retrievalResult.combinedContext,
          abortSignal,
          retrievalResult.timelineFillResult,
          retrievalResult.worldStateBlock,
        )) {
          if (abortSignal?.aborted) {
            activity.endStep(waitId, 'skipped')
            activity.endStep(attemptId, 'skipped')
            activity.endStep(narrativeStepId, 'skipped')
            yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
            return null
          }

          if (waitId && (chunk.content || chunk.reasoning)) {
            activity.endStep(waitId)
            waitId = ''
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

        activity.endStep(waitId, 'done', 'no tokens')
        if (fullResponse.trim()) {
          activity.endStep(attemptId, 'done', `${chunkCount} chunks`)
          break // Success
        }
        activity.endStep(attemptId, 'done', 'empty response')
        retryCount++
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError'
        activity.endStep(waitId, aborted ? 'skipped' : 'failed')
        activity.endStep(attemptId, aborted ? 'skipped' : 'failed')
        activity.endStep(narrativeStepId, aborted ? 'skipped' : 'failed')
        if (aborted) {
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
      activity.endStep(narrativeStepId, 'skipped')
      yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
      return null
    }

    if (!fullResponse.trim()) {
      activity.endStep(
        narrativeStepId,
        'failed',
        `empty after ${MAX_EMPTY_RESPONSE_RETRIES} attempts`,
      )
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

    activity.endStep(narrativeStepId)

    yield {
      type: 'phase_complete',
      phase: 'narrative',
      result,
    } satisfies PhaseCompleteEvent

    return result
  }
}
