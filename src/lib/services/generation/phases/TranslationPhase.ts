/**
 * TranslationPhase - Handles translation of narration and world state elements
 *
 * Responsibilities:
 * - Translate narrative content to target language (if enabled)
 * - Coordinate translations (narration, suggestions, action choices done elsewhere)
 * - Handle translation errors gracefully (non-fatal)
 *
 * NOTE: Translation service is currently stubbed. This phase gracefully handles
 * errors so the pipeline continues even when translation fails.
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  AbortedEvent,
  ErrorEvent,
} from '../types'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { story } from '$lib/stores/story/index.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { aiService } from '$lib/services/ai'

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
  /** Execute the translation phase - yields events */
  async *execute(): AsyncGenerator<GenerationEvent> {
    yield { type: 'phase_start', phase: 'translation' } satisfies PhaseStartEvent

    const abortSignal = story.generationContext.abortSignal ?? undefined
    const translationSettings = settings.translationSettings

    // Check if translation should be skipped
    if (!TranslationService.shouldTranslateNarration(translationSettings)) {
      const result: TranslationResult2 = {
        translated: false,
        translatedContent: null,
        targetLanguage: null,
      }

      story.generationContext.translationResult = result
      yield {
        type: 'phase_complete',
        phase: 'translation',
        result,
      } satisfies PhaseCompleteEvent

      return
    }

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'translation' } satisfies AbortedEvent
      const result: TranslationResult2 = {
        translated: false,
        translatedContent: null,
        targetLanguage: null,
      }
      story.generationContext.translationResult = result
      return
    }

    const targetLanguage = translationSettings.targetLanguage

    try {
      const translationResult = await aiService.translateNarration()

      if (abortSignal?.aborted) {
        yield { type: 'aborted', phase: 'translation' } satisfies AbortedEvent
        const result: TranslationResult2 = {
          translated: false,
          translatedContent: null,
          targetLanguage: null,
        }
        story.generationContext.translationResult = result
        return
      }

      const result: TranslationResult2 = {
        translated: true,
        translatedContent: translationResult.translatedContent,
        targetLanguage,
      }

      story.generationContext.translationResult = result
      yield {
        type: 'phase_complete',
        phase: 'translation',
        result,
      } satisfies PhaseCompleteEvent

      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'aborted', phase: 'translation' } satisfies AbortedEvent
        const result: TranslationResult2 = {
          translated: false,
          translatedContent: null,
          targetLanguage: null,
        }
        story.generationContext.translationResult = result
        return
      }

      // Translation errors are non-fatal - log and continue with original content
      yield {
        type: 'error',
        phase: 'translation',
        error: error instanceof Error ? error : new Error(String(error)),
        fatal: false,
      } satisfies ErrorEvent

      const result: TranslationResult2 = {
        translated: false,
        translatedContent: null,
        targetLanguage: null,
      }
      story.generationContext.translationResult = result
      return
    }
  }
}
