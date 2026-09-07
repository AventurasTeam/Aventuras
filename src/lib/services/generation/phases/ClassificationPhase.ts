/**
 * ClassificationPhase - Handles world state extraction from narrative
 *
 * Responsibilities:
 * - Call classifier service to extract world state changes
 * - Coordinate entity updates (characters, locations, items, story beats)
 * - Yield classification events
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  AbortedEvent,
  ErrorEvent,
  ClassificationCompleteEvent,
  WorldState,
} from '../types'
import type { Story, StoryEntry, TimeTracker } from '$lib/types'
import type { ClassificationResult } from '$lib/services/ai/sdk/schemas/classifier'

/** Dependencies for classification phase - injected to avoid tight coupling */
import { NO_ACTIVITY, type ActivityReporter } from '$lib/services/activity'

export interface ClassificationDependencies {
  classifyResponse: (
    narrativeResponse: string,
    userAction: string,
    worldState: WorldState,
    story: Story | null | undefined,
    chatHistoryEntries: StoryEntry[],
    timeTracker: TimeTracker | null | undefined,
  ) => Promise<ClassificationResult>
}

/** Input for the classification phase */
export interface ClassificationInput {
  narrativeContent: string
  narrativeEntryId: string
  userActionContent: string
  worldState: WorldState
  story: Story | null | undefined
  visibleEntries: StoryEntry[]
  abortSignal?: AbortSignal
  activity?: ActivityReporter
  /** Step this phase's own reporting nests under. */
  activityParentId?: string | null
}

/** Result from classification phase */
export interface ClassificationPhaseResult {
  classificationResult: ClassificationResult
  narrativeEntryId: string
}

/**
 * ClassificationPhase service
 * Extracts world state changes from narrative using AI classifier.
 */
export class ClassificationPhase {
  constructor(private deps: ClassificationDependencies) {}

  /** Execute the classification phase - yields events and returns result */
  async *execute(
    input: ClassificationInput,
  ): AsyncGenerator<GenerationEvent, ClassificationPhaseResult | null> {
    yield { type: 'phase_start', phase: 'classification' } satisfies PhaseStartEvent

    const {
      narrativeContent,
      narrativeEntryId,
      userActionContent,
      worldState,
      story,
      visibleEntries,
      abortSignal,
    } = input

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
      return null
    }

    try {
      // Filter out the current narration entry to avoid sending it twice
      // (once in chatHistory, once as narrativeResponse)
      const chatHistoryEntries = visibleEntries.filter((e) => e.id !== narrativeEntryId)

      const activity = input.activity ?? NO_ACTIVITY
      const callId = activity.startStep('Classifying', {
        parentId: input.activityParentId,
        isLLM: true,
      })
      let classificationResult
      try {
        classificationResult = await this.deps.classifyResponse(
          narrativeContent,
          userActionContent,
          worldState,
          story,
          chatHistoryEntries,
          story?.timeTracker,
        )
        activity.endStep(callId)
      } catch (error) {
        activity.endStep(
          callId,
          error instanceof Error && error.name === 'AbortError' ? 'skipped' : 'failed',
        )
        throw error
      }

      if (abortSignal?.aborted) {
        yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
        return null
      }

      // Emit classification complete event
      yield {
        type: 'classification_complete',
        result: classificationResult,
      } satisfies ClassificationCompleteEvent

      const result: ClassificationPhaseResult = {
        classificationResult,
        narrativeEntryId,
      }

      yield {
        type: 'phase_complete',
        phase: 'classification',
        result,
      } satisfies PhaseCompleteEvent

      return result
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
        return null
      }

      // Classification errors are non-fatal - world state just won't be updated
      yield {
        type: 'error',
        phase: 'classification',
        error: error instanceof Error ? error : new Error(String(error)),
        fatal: false,
      } satisfies ErrorEvent

      return null
    }
  }
}
