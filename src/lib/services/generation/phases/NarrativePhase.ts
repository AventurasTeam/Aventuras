/**
 * NarrativePhase - Handles streaming narrative generation
 *
 * Responsibilities:
 * - Coordinate streaming narrative generation via AIService
 * - Yield narrative chunks as they arrive
 * - Handle abort signals properly
 * - Retry on empty responses (up to 3 passes)
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
import { NO_ACTIVITY, failStep, type ActivityReporter } from '$lib/services/activity'

const MAX_EMPTY_RESPONSE_RETRIES = 3
const EMPTY_RESPONSE = 'Empty response'

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
    activityParentId?: string,
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
 * Handles automatic retry on empty responses (up to 3 passes).
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
    let contentChunks = 0
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
      contentChunks = 0

      // A pass after the first is its own step, so three empty responses do not read as one long
      // wait. The first gets one only once a second follows it. "Pass", not "Attempt": attempts are
      // the transport retries, reported inside a pass.
      const passId =
        retryCount > 0
          ? activity.startStep(`Pass ${retryCount + 1}`, {
              parentId: narrativeStepId,
              attempt: true,
            })
          : ''
      const parentId = passId || narrativeStepId
      // The wait gives way to the response as soon as it starts arriving, content or not, so the
      // two are consecutive children of the pass and an empty answer still shows as one.
      let waitId = activity.startStep('Waiting for model', { parentId })
      let streamId = ''

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
          parentId,
        )) {
          if (abortSignal?.aborted) {
            activity.endStep(waitId, 'skipped')
            activity.endStep(streamId, 'skipped')
            activity.endStep(passId, 'skipped')
            activity.endStep(narrativeStepId, 'skipped')
            yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
            return null
          }

          if (waitId && (chunk.started || chunk.content || chunk.reasoning)) {
            activity.endStep(waitId)
            waitId = ''
            streamId = activity.startStep('Generating', { parentId, isLLM: true })
          }
          if (chunk.started) continue

          chunkCount++
          if (chunk.content || chunk.reasoning) contentChunks++

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

        activity.endStep(waitId, 'done', 'no response')
        activity.endStep(
          streamId,
          'done',
          contentChunks ? `${contentChunks} chunk${contentChunks === 1 ? '' : 's'}` : 'no content',
        )
        if (fullResponse.trim()) {
          activity.endStep(passId)
          break // Success
        }
        if (passId) activity.endStep(passId, 'failed', undefined, EMPTY_RESPONSE)
        else
          activity.groupChildren?.(narrativeStepId, 'Pass 1', {
            status: 'failed',
            error: EMPTY_RESPONSE,
            attempt: true,
          })
        retryCount++
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError'
        for (const id of [waitId, streamId, passId, narrativeStepId]) failStep(activity, id, error)
        if (aborted) {
          yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
          return null
        }
        // Text streamed before the error is kept as the narration: it was paid for.
        const partial = !!fullResponse.trim()
        yield {
          type: 'error',
          phase: 'narrative',
          error: error instanceof Error ? error : new Error(String(error)),
          fatal: !partial,
        } satisfies ErrorEvent
        if (!partial) return null
        break
      }
    }

    if (abortSignal?.aborted) {
      activity.endStep(narrativeStepId, 'skipped')
      yield { type: 'aborted', phase: 'narrative' } satisfies AbortedEvent
      return null
    }

    if (!fullResponse.trim()) {
      const reason = `${EMPTY_RESPONSE} after ${MAX_EMPTY_RESPONSE_RETRIES} passes`
      activity.endStep(narrativeStepId, 'failed', undefined, reason)
      yield {
        type: 'error',
        phase: 'narrative',
        error: new Error(reason),
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
