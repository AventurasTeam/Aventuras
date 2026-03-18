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
import { storyContext } from '$lib/stores/storyContext.svelte'
import { settings } from '$lib/stores/settings.svelte'

/** Prompt context for macro expansion */
export interface PromptContext {
  mode: 'adventure' | 'creative-writing'
  pov: 'first' | 'second' | 'third'
  tense: 'past' | 'present'
  protagonistName: string
  genre?: string
  settingDescription?: string
  tone?: string
  themes?: string[]
}

/** Dependencies for post-generation phase */
export interface PostGenerationDependencies {
  generateSuggestions: () => Promise<{ suggestions: Suggestion[] }>
  translateSuggestions: (suggestions: Suggestion[], targetLanguage: string) => Promise<Suggestion[]>
  generateActionChoices: () => Promise<{ choices: ActionChoice[] }>
  translateActionChoices: (
    choices: ActionChoice[],
    targetLanguage: string,
  ) => Promise<ActionChoice[]>
}

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
  constructor(private deps: PostGenerationDependencies) {}

  async *execute(): AsyncGenerator<GenerationEvent, PostGenerationResult> {
    yield { type: 'phase_start', phase: 'post' } satisfies PhaseStartEvent

    const isCreativeMode = storyContext.storyMode === 'creative-writing'
    const abortSignal = storyContext.abortSignal ?? undefined
    const disableSuggestions = settings.uiSettings.disableSuggestions

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'post' } satisfies AbortedEvent
      return { suggestions: null, actionChoices: null }
    }

    const result: PostGenerationResult = { suggestions: null, actionChoices: null }

    if (!disableSuggestions) {
      if (isCreativeMode) {
        try {
          result.suggestions = await this.generateSuggestions(settings.translationSettings)
        } catch (error) {
          yield this.errorEvent(error)
        }
      } else {
        try {
          result.actionChoices = await this.generateActionChoices(settings.translationSettings)
        } catch (error) {
          yield this.errorEvent(error)
        }
      }
    }

    storyContext.postGenerationResult = result
    yield { type: 'phase_complete', phase: 'post', result } satisfies PhaseCompleteEvent
    return result
  }

  private async generateSuggestions(
    translationSettings: TranslationSettings,
  ): Promise<Suggestion[]> {
    const { suggestions } = await this.deps.generateSuggestions()

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        return await this.deps.translateSuggestions(suggestions, translationSettings.targetLanguage)
      } catch {
        return suggestions
      }
    }
    return suggestions
  }

  private async generateActionChoices(
    translationSettings: TranslationSettings,
  ): Promise<ActionChoice[]> {
    const { choices } = await this.deps.generateActionChoices()

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        return await this.deps.translateActionChoices(choices, translationSettings.targetLanguage)
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
