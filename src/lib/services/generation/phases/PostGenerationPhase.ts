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
import type {
  StoryEntry,
  Entry,
  TranslationSettings,
  Character,
  Location,
  Item,
  StoryBeat,
} from '$lib/types'
import type { Suggestion, ActionChoice } from '$lib/services/ai/sdk/schemas'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'

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

/** World state for action choices */
export interface PostWorldState {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
}

/** Dependencies for post-generation phase */
export interface PostGenerationDependencies {
  generateSuggestions: (
    entries: StoryEntry[],
    activeThreads: StoryBeat[],
    lorebookEntries?: Entry[],
    promptContext?: PromptContext,
    latestNarrativeResponse?: string,
  ) => Promise<{ suggestions: Suggestion[] }>
  translateSuggestions: (suggestions: Suggestion[], targetLanguage: string) => Promise<Suggestion[]>
  generateActionChoices: (
    entries: StoryEntry[],
    worldState: PostWorldState,
    narrativeResponse: string,
    lorebookEntries: Entry[],
    promptContext: PromptContext,
    pov: 'first' | 'second' | 'third',
  ) => Promise<{ choices: ActionChoice[] }>
  translateActionChoices: (
    choices: ActionChoice[],
    targetLanguage: string,
  ) => Promise<ActionChoice[]>
}

/** Input for the post-generation phase */
export interface PostGenerationInput {
  isCreativeMode: boolean
  disableSuggestions: boolean
  entries: StoryEntry[]
  activeThreads: StoryBeat[]
  lorebookEntries: Entry[]
  promptContext: PromptContext
  worldState: PostWorldState
  narrativeResponse: string
  pov: 'first' | 'second' | 'third'
  translationSettings: TranslationSettings
  abortSignal?: AbortSignal
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

  async *execute(
    input: PostGenerationInput,
  ): AsyncGenerator<GenerationEvent, PostGenerationResult> {
    yield { type: 'phase_start', phase: 'post' } satisfies PhaseStartEvent

    const { isCreativeMode, disableSuggestions, abortSignal } = input

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'post' } satisfies AbortedEvent
      return { suggestions: null, actionChoices: null }
    }

    const result: PostGenerationResult = { suggestions: null, actionChoices: null }

    if (!disableSuggestions) {
      if (isCreativeMode) {
        try {
          result.suggestions = await this.generateSuggestions(input)
        } catch (error) {
          yield this.errorEvent(error)
        }
      } else {
        try {
          result.actionChoices = await this.generateActionChoices(input)
        } catch (error) {
          yield this.errorEvent(error)
        }
      }
    }

    yield { type: 'phase_complete', phase: 'post', result } satisfies PhaseCompleteEvent
    return result
  }

  private async generateSuggestions(input: PostGenerationInput): Promise<Suggestion[]> {
    const {
      entries,
      activeThreads,
      lorebookEntries,
      promptContext,
      narrativeResponse,
      translationSettings,
    } = input
    const { suggestions } = await this.deps.generateSuggestions(
      entries,
      activeThreads,
      lorebookEntries,
      promptContext,
      narrativeResponse,
    )

    if (TranslationService.shouldTranslate(translationSettings)) {
      try {
        return await this.deps.translateSuggestions(suggestions, translationSettings.targetLanguage)
      } catch {
        return suggestions
      }
    }
    return suggestions
  }

  private async generateActionChoices(input: PostGenerationInput): Promise<ActionChoice[]> {
    const {
      entries,
      lorebookEntries,
      promptContext,
      worldState,
      narrativeResponse,
      pov,
      translationSettings,
    } = input
    const { choices } = await this.deps.generateActionChoices(
      entries,
      worldState,
      narrativeResponse,
      lorebookEntries,
      promptContext,
      pov,
    )

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
