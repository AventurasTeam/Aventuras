/**
 * PostGenerationPhase - Handles post-generation tasks
 *
 * Responsibilities:
 * - Coordinate suggestions generation (for creative-writing mode)
 * - Coordinate action choices generation (for adventure mode)
 * - Handle translation for suggestions/action choices if enabled
 *
 * NOTE: Lore management runs after chapter creation (checkAutoSummarize),
 * not as part of the standard post-generation flow.
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  AbortedEvent,
  ErrorEvent,
} from '../types'
import type { TranslationSettings } from '$lib/types'
import type { Suggestion, ActionChoice } from '$lib/services/ai/sdk/schemas'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { story } from '$lib/stores/story/index.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { aiService } from '$lib/services/ai'

/** Result from post-generation phase */
export interface PostGenerationResult {
  suggestions: Suggestion[] | null
  actionChoices: ActionChoice[] | null
}

/**
 * PostGenerationPhase service
 * Coordinates suggestions and action choices generation.
 * Errors are non-fatal - generation continues even if suggestions fail.
 */
export class PostGenerationPhase {
  async *execute(): AsyncGenerator<GenerationEvent> {
    yield { type: 'phase_start', phase: 'post' } satisfies PhaseStartEvent

    const isCreativeWritingMode = story.mode === 'creative-writing'
    const abortSignal = story.generationContext.abortSignal ?? undefined
    const disableSuggestions = settings.uiSettings.disableSuggestions

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'post' } satisfies AbortedEvent
      return
    }

    const result: PostGenerationResult = { suggestions: null, actionChoices: null }

    if (!disableSuggestions) {
      if (isCreativeWritingMode) {
        try {
          result.suggestions = await this.generateSuggestions(settings.translationSettings)
        } catch (error) {
          yield this.errorEvent(error)
          return
        }
      } else {
        try {
          result.actionChoices = await this.generateActionChoices(settings.translationSettings)
        } catch (error) {
          yield this.errorEvent(error)
          return
        }
      }
    }

    story.generationContext.postGenerationResult = result
    yield { type: 'phase_complete', phase: 'post', result } satisfies PhaseCompleteEvent
    return
  }

  private async generateSuggestions(
    translationSettings: TranslationSettings,
  ): Promise<Suggestion[]> {
    const { suggestions } = await aiService.generateSuggestions()

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        story.generationContext.suggestionsToTranslate = suggestions
        return await aiService.translateSuggestions()
      } catch {
        return suggestions
      }
    }
    return suggestions
  }

  private async generateActionChoices(
    translationSettings: TranslationSettings,
  ): Promise<ActionChoice[]> {
    const { choices } = await aiService.generateActionChoices()

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        story.generationContext.actionChoicesToTranslate = choices
        return await aiService.translateActionChoices()
      } catch {
        return choices
      }
    }
    return choices
  }

  private errorEvent(error: unknown): ErrorEvent {
    return {
      type: 'error',
      phase: 'post',
      error: error instanceof Error ? error : new Error(String(error)),
      fatal: false,
    }
  }
}
