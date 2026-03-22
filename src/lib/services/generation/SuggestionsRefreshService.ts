/**
 * SuggestionsRefreshService - Handles manual suggestion refresh logic extracted from ActionInput.svelte.
 * Coordinates suggestion generation and optional translation for creative writing mode.
 * Uses zero-arg generateSuggestions() that reads from storyContext singleton.
 */

import type { TranslationSettings } from '$lib/types'
import type { Suggestion, SuggestionsResult } from '$lib/services/ai/sdk/schemas/suggestions'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { story } from '$lib/stores/story/index.svelte'

function log(...args: unknown[]) {
  console.log('[SuggestionsRefreshService]', ...args)
}

export interface SuggestionsRefreshInput {
  translationSettings: TranslationSettings
}

export interface SuggestionsRefreshDependencies {
  generateSuggestions: () => Promise<SuggestionsResult>
  translateSuggestions: (suggestions: Suggestion[], targetLanguage: string) => Promise<Suggestion[]>
}

export interface SuggestionsRefreshResult {
  suggestions: Suggestion[]
  translated: boolean
}

export class SuggestionsRefreshService {
  private deps: SuggestionsRefreshDependencies

  constructor(deps: SuggestionsRefreshDependencies) {
    this.deps = deps
  }

  /**
   * Refresh suggestions for creative writing mode.
   * generateSuggestions() reads all context from storyContext singleton.
   * Returns empty array if not in creative mode or no entries exist.
   */
  async refresh(input: SuggestionsRefreshInput): Promise<SuggestionsRefreshResult> {
    const { translationSettings } = input

    // Only generate suggestions in creative writing mode with entries
    const storyMode = story.mode
    const hasEntries = story.entry.entries.length > 0
    if (storyMode !== 'creative-writing' || !hasEntries) {
      log('Skipping refresh', { storyMode, hasEntries })
      return { suggestions: [], translated: false }
    }

    const result = await this.deps.generateSuggestions()

    // Translate if enabled
    let finalSuggestions = result.suggestions
    let translated = false

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        finalSuggestions = await this.deps.translateSuggestions(
          result.suggestions,
          translationSettings.targetLanguage,
        )
        translated = true
        log('Suggestions translated')
      } catch (error) {
        log('Suggestion translation failed (non-fatal):', error)
      }
    }

    log('Suggestions refreshed:', finalSuggestions.length)
    return { suggestions: finalSuggestions, translated }
  }
}
