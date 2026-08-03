/**
 * TranslationPhase - Handles translation of narration and world state elements
 *
 * Responsibilities:
 * - Translate narrative content to target language (if enabled)
 * - Coordinate translations (narration, suggestions, action choices done elsewhere)
 * - Handle translation errors gracefully (non-fatal)
 *
 * Errors are handled gracefully (non-fatal) so the pipeline continues even when
 * a translation call fails.
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  AbortedEvent,
  ErrorEvent,
} from '../types'
import type { TranslationSettings } from '$lib/types'
import type { TranslationResult } from '$lib/services/ai/utils/TranslationService'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'

/** Dependencies for translation phase - injected to avoid tight coupling */
export interface TranslationDependencies {
  translateNarration: (
    content: string,
    targetLanguage: string,
    isVisualProse: boolean,
  ) => Promise<TranslationResult>
}

/** Input for the translation phase */
export interface TranslationInput {
  narrativeContent: string
  narrativeEntryId: string
  isVisualProse: boolean
  translationSettings: TranslationSettings
  abortSignal?: AbortSignal
}

/** Result from translation phase */
export interface TranslationResult2 {
  translated: boolean
  translatedContent: string | null
  targetLanguage: string | null
}

/**
 * TranslationPhase service
 * Translates narrative content to target language.
 * Errors are non-fatal - if translation fails, the pipeline continues with original content.
 */
export class TranslationPhase {
  constructor(private deps: TranslationDependencies) {}

  /** Execute the translation phase - yields events and returns result */
  async *execute(input: TranslationInput): AsyncGenerator<GenerationEvent, TranslationResult2> {
    yield { type: 'phase_start', phase: 'translation' } satisfies PhaseStartEvent

    const { narrativeContent, isVisualProse, translationSettings, abortSignal } = input

    // Check if translation should be skipped
    if (!TranslationService.shouldTranslateNarration(translationSettings)) {
      const result: TranslationResult2 = {
        translated: false,
        translatedContent: null,
        targetLanguage: null,
      }

      yield {
        type: 'phase_complete',
        phase: 'translation',
        result,
      } satisfies PhaseCompleteEvent

      return result
    }

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'translation' } satisfies AbortedEvent
      return {
        translated: false,
        translatedContent: null,
        targetLanguage: null,
      }
    }

    const targetLanguage = translationSettings.targetLanguage

    try {
      const translationResult = await this.deps.translateNarration(
        narrativeContent,
        targetLanguage,
        isVisualProse,
      )

      if (abortSignal?.aborted) {
        yield { type: 'aborted', phase: 'translation' } satisfies AbortedEvent
        return {
          translated: false,
          translatedContent: null,
          targetLanguage: null,
        }
      }

      const result: TranslationResult2 = {
        translated: true,
        translatedContent: translationResult.translatedContent,
        targetLanguage,
      }

      yield {
        type: 'phase_complete',
        phase: 'translation',
        result,
      } satisfies PhaseCompleteEvent

      return result
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'aborted', phase: 'translation' } satisfies AbortedEvent
        return {
          translated: false,
          translatedContent: null,
          targetLanguage: null,
        }
      }

      // Translation errors are non-fatal - log and continue with original content
      yield {
        type: 'error',
        phase: 'translation',
        error: error instanceof Error ? error : new Error(String(error)),
        fatal: false,
      } satisfies ErrorEvent

      return {
        translated: false,
        translatedContent: null,
        targetLanguage: null,
      }
    }
  }
}
