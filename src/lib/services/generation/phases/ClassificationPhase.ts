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
import { NO_ACTIVITY, failStep, type ActivityReporter } from '$lib/services/activity'

export interface ClassificationDependencies {
  classifyResponse: (
    narrativeResponse: string,
    userAction: string,
    worldState: WorldState,
    story: Story | null | undefined,
    chatHistoryEntries: StoryEntry[],
    timeTracker: TimeTracker | null | undefined,
    activityParentId?: string,
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
          callId,
        )
      } catch (error) {
        failStep(activity, callId, error)
        throw error
      }

      // The classifier absorbs its failures into `_error`. A salvaged result is still applied.
      const failure = classificationResult._error
      if (!failure) activity.endStep(callId)
      else if (classificationResult._salvaged)
        activity.endStep(callId, 'done', 'partly applied', failure)
      else {
        activity.endStep(callId, 'failed', undefined, failure)
        yield {
          type: 'error',
          phase: 'classification',
          error: new Error(failure),
          fatal: false,
        } satisfies ErrorEvent
      }

      if (abortSignal?.aborted) {
        yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
        return null
      }

      // The phase stays suspended at this yield while the consumer applies the result, so the
      // step spans exactly that work.
      const applyId = activity.startStep('Updating world', { parentId: input.activityParentId })
      let applied = false
      try {
        yield {
          type: 'classification_complete',
          result: classificationResult,
          applyStepId: applyId,
        } satisfies ClassificationCompleteEvent
        applied = true
      } finally {
        // Resumed means handled; abandoned here means stopped, or the consumer threw and has
        // already closed the step as failed.
        activity.endStep(applyId, applied ? 'done' : 'skipped')
      }

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
