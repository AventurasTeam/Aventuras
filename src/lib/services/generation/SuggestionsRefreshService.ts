/**
 * SuggestionsRefreshService - Handles manual suggestion refresh logic extracted from ActionInput.svelte.
 * Coordinates suggestion generation and optional translation for creative writing mode.
 */

import type { StoryEntry, StoryBeat, Entry, StoryMode, TranslationSettings } from '$lib/types'
import type { Suggestion, SuggestionsResult } from '$lib/services/ai/sdk/schemas/suggestions'
import type { RetrievedEntry } from '$lib/services/ai/retrieval/EntryRetrievalService'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { createLogger } from '$lib/log'

const log = createLogger('SuggestionsRefreshService')

export interface SuggestionsRefreshInput {
  storyId: string
  entries: StoryEntry[]
  pendingQuests: StoryBeat[]
  storyMode: StoryMode
  lastLorebookRetrieval: RetrievedEntry[] | null
  translationSettings: TranslationSettings
}

export interface SuggestionsRefreshDependencies {
  generateSuggestions: (
    entries: StoryEntry[],
    activeThreads: StoryBeat[],
    lorebookEntries: Entry[],
    latestNarrativeResponse: string | undefined,
    storyId: string | undefined,
  ) => Promise<SuggestionsResult>
  translateSuggestions: (
    suggestions: Suggestion[],
    targetLanguage: string,
    storyId: string | undefined,
  ) => Promise<Suggestion[]>
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
   * Returns empty array if not in creative mode or no entries exist.
   */
  async refresh(input: SuggestionsRefreshInput): Promise<SuggestionsRefreshResult> {
    const {
      storyId,
      entries,
      pendingQuests,
      storyMode,
      lastLorebookRetrieval,
      translationSettings,
    } = input

    // Only generate suggestions in creative writing mode with entries
    if (storyMode !== 'creative-writing' || entries.length === 0) {
      log('Skipping refresh', { storyMode, entriesCount: entries.length })
      return { suggestions: [], translated: false }
    }

    // Extract Entry objects from RetrievedEntry wrappers
    const activeLorebookEntries = (lastLorebookRetrieval ?? []).map((r) => r.entry)

    const result = await this.deps.generateSuggestions(
      entries,
      pendingQuests,
      activeLorebookEntries,
      undefined,
      storyId,
    )

    // Translate if enabled
    let finalSuggestions = result.suggestions
    let translated = false

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        finalSuggestions = await this.deps.translateSuggestions(
          result.suggestions,
          translationSettings.targetLanguage,
          storyId,
        )
        translated = true
        log('Suggestions translated')
      } catch (error) {
        log('Suggestion translation failed (non-fatal):', error)
      }
    }

    log(
      'Suggestions refreshed:',
      finalSuggestions.length,
      'with',
      activeLorebookEntries.length,
      'active lorebook entries',
    )
    return { suggestions: finalSuggestions, translated }
  }
}
