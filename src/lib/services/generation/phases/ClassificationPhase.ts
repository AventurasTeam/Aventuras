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
import { storyContext } from '$lib/stores/storyContext.svelte'

/** Dependencies for classification phase - injected to avoid tight coupling */
export interface ClassificationDependencies {
  classifyResponse: () => Promise<ClassificationResult>
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
  async *execute(): AsyncGenerator<GenerationEvent, ClassificationPhaseResult | null> {
    // === CONCURRENT PHASE SAFETY: Snapshot singleton inputs before first yield ===
    const narrativeEntryId = storyContext.narrationEntryId ?? ''
    const abortSignal = storyContext.abortSignal ?? undefined
    // === End snapshot block ===

    yield { type: 'phase_start', phase: 'classification' } satisfies PhaseStartEvent

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
      return null
    }

    try {
      // ClassifierService.classify() reads all data from singleton (narrationEntryId filtering included)
      const classificationResult = await this.deps.classifyResponse()

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

      storyContext.classificationResult = result
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
