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
} from '../types'
import type { ClassificationResult } from '$lib/services/ai/sdk/schemas/classifier'
import { story } from '$lib/stores/story/index.svelte'
import { aiService } from '$lib/services/ai'

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
  /** Execute the classification phase - yields events and returns result */
  async *execute(): AsyncGenerator<GenerationEvent> {
    // === CONCURRENT PHASE SAFETY: Snapshot singleton inputs before first yield ===
    const narrativeEntryId = story.generationContext.narrationEntryId ?? ''
    const abortSignal = story.generationContext.abortSignal ?? undefined
    // === End snapshot block ===

    yield { type: 'phase_start', phase: 'classification' } satisfies PhaseStartEvent

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
      return
    }

    try {
      // ClassifierService.classify() reads all data from singleton (narrationEntryId filtering included)
      const classificationResult = await aiService.classifyResponse()

      if (abortSignal?.aborted) {
        yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
        return
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

      story.generationContext.classificationResult = result
      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
        return
      }

      // Classification errors are non-fatal - world state just won't be updated
      yield {
        type: 'error',
        phase: 'classification',
        error: error instanceof Error ? error : new Error(String(error)),
        fatal: false,
      } satisfies ErrorEvent

      return
    }
  }
}
