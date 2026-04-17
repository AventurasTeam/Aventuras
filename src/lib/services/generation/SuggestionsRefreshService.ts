/**
 * SuggestionsRefreshService - Handles manual suggestion refresh logic extracted from ActionInput.svelte.
 * Coordinates suggestion generation and optional translation for creative writing mode.
 * Uses zero-arg generateSuggestions() that reads from storyContext singleton.
 */

import type { Suggestion } from '$lib/services/ai/sdk/schemas/suggestions'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { story } from '$lib/stores/story/index.svelte'
import { aiService } from '../ai'
import { settings } from '$lib/stores/settings.svelte'

function log(...args: unknown[]) {
  console.log('[SuggestionsRefreshService]', ...args)
}

export interface SuggestionsRefreshResult {
  suggestions: Suggestion[]
  translated: boolean
}

export class SuggestionsRefreshService {
  /**
   * Refresh suggestions for creative writing mode.
   * generateSuggestions() reads all context from storyContext singleton.
   * Returns empty array if not in creative mode or no entries exist.
   */
  async refresh(): Promise<SuggestionsRefreshResult> {
    const translationSettings = settings.translationSettings

    // Only generate suggestions in creative writing mode with entries
    const storyMode = story.mode
    const hasEntries = story.entry.rawEntries.length > 0
    if (storyMode !== 'creative-writing' || !hasEntries) {
      log('Skipping refresh', { storyMode, hasEntries })
      return { suggestions: [], translated: false }
    }

    const result = await aiService.generateSuggestions()

    // Translate if enabled
    let finalSuggestions = result.suggestions
    let translated = false

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        story.generationContext.suggestionsToTranslate = result.suggestions
        finalSuggestions = await aiService.translateSuggestions()
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
