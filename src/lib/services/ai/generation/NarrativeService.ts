/**
 * Narrative Service
 *
 * The core service that generates story responses.
 * This is the heart of the application - it handles narrative generation
 * both streaming and non-streaming.
 *
 * Unlike other services that use the preset system, NarrativeService uses
 * the main narrative profile directly (apiSettings.defaultModel, temperature, maxTokens).
 *
 * Uses ContextBuilder for prompt generation through the unified Liquid template pipeline.
 */

import { streamNarrative, generateNarrative } from '../sdk/generate'
import { ContextBuilder } from '$lib/services/context'
import { mapChaptersToContext } from '$lib/services/context/chapterMapper'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'
import { createLogger } from '$lib/log'
import type { StreamChunk } from '../core/types'
import type {
  Story,
  StoryEntry,
  Entry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
} from '$lib/types'
import type { StyleReviewResult } from './StyleReviewerService'
import type { TimelineFillResult } from '../retrieval/TimelineFillService'
import type { WorldStateArrays } from '$lib/services/context/worldStateMapper'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'

const log = createLogger('Narrative')

/**
 * World state context for prompt building
 */
export interface WorldStateContext {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  currentLocation?: Location
  chapters?: Chapter[]
}

/**
 * World state context for narrative generation.
 * Extends the base WorldStateContext with lorebook entries.
 */
export interface NarrativeWorldState extends WorldStateContext {
  lorebookEntries?: Entry[]
}

/**
 * Options for narrative generation.
 */
export interface NarrativeOptions {
  /** World state arrays from the tiered context mapper */
  worldStateArrays?: WorldStateArrays
  /** Style review results for avoiding repetition */
  styleReview?: StyleReviewResult | null
  /** Agentic retrieval context from memory system (replaces retrievedChapterContext) */
  agenticRetrievalContext?: string | null
  /** Lorebook entries for structured lorebook injection */
  lorebookEntries?: ContextLorebookEntry[]
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Timeline fill result for Q&A injection */
  timelineFillResult?: TimelineFillResult | null
}

/**
 * Service for generating narrative responses.
 *
 * This service uses the main narrative profile from apiSettings directly,
 * rather than going through the preset system. This ensures narrative
 * generation uses the user's primary model and settings.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */
export class NarrativeService {
  /**
   * Create a new NarrativeService.
   * No preset required - uses main narrative profile from settings.
   */
  constructor() {
    // No configuration needed - uses main profile directly
  }

  /**
   * Stream a narrative response.
   *
   * This is the primary method used by the UI for real-time narrative generation.
   * Yields StreamChunk objects as text arrives from the model.
   */
  async *stream(
    entries: StoryEntry[],
    worldState: NarrativeWorldState,
    story?: Story | null,
    options: NarrativeOptions = {},
  ): AsyncIterable<StreamChunk> {
    const {
      worldStateArrays,
      styleReview,
      agenticRetrievalContext,
      lorebookEntries,
      signal,
      timelineFillResult,
    } = options

    log('stream', {
      entriesCount: entries.length,
      hasTieredContext: !!worldStateArrays,
      hasStyleReview: !!styleReview,
      hasAgenticContext: !!agenticRetrievalContext,
      hasTimelineFill: !!timelineFillResult,
      lorebookEntriesCount: lorebookEntries?.length ?? 0,
    })

    const inlineImageMode = story?.settings?.imageGenerationMode === 'inline'

    // Build system prompt and user message via ContextBuilder pipeline
    const { systemPrompt, userMessage } = await this.buildPrompts(
      entries,
      inlineImageMode,
      story,
      worldState,
      worldStateArrays,
      styleReview,
      agenticRetrievalContext,
      lorebookEntries,
      timelineFillResult,
    )

    try {
      // Stream using the main narrative profile
      const stream = streamNarrative({
        system: systemPrompt,
        prompt: userMessage,
        signal,
      })

      // Use fullStream to capture both text and reasoning
      // - Native reasoning providers (Anthropic, OpenAI) emit reasoning-delta parts
      // - Models using <think> tags have reasoning extracted by extractReasoningMiddleware
      for await (const part of stream.fullStream) {
        if (part.type === 'reasoning-delta') {
          // Reasoning delta from native providers or extracted from <think> tags
          yield { content: '', reasoning: (part as { text?: string }).text, done: false }
        } else if (part.type === 'text-delta') {
          // Regular text content
          yield { content: (part as { text?: string }).text || '', done: false }
        }
        // Ignore other part types (reasoning-start, reasoning-end, tool calls, finish, etc.)
      }

      yield { content: '', done: true }
    } catch (error) {
      log('stream error', error)
      // Re-throw to let caller handle the error
      throw error
    }
  }

  /**
   * Generate a complete narrative response (non-streaming).
   *
   * Used for scenarios where streaming is not needed or supported.
   */
  async generate(
    entries: StoryEntry[],
    worldState: NarrativeWorldState,
    story?: Story | null,
    options: Omit<NarrativeOptions, 'timelineFillResult'> = {},
  ): Promise<string> {
    const { worldStateArrays, styleReview, agenticRetrievalContext, lorebookEntries, signal } =
      options

    log('generate', { entriesCount: entries.length })

    const inlineImageMode = story?.settings?.imageGenerationMode === 'inline'

    // Build system prompt and user message via ContextBuilder pipeline
    const { systemPrompt, userMessage } = await this.buildPrompts(
      entries,
      inlineImageMode,
      story,
      worldState,
      worldStateArrays,
      styleReview,
      agenticRetrievalContext,
      lorebookEntries,
    )

    return generateNarrative({
      system: systemPrompt,
      prompt: userMessage,
      signal,
    })
  }

  /**
   * Build system and priming prompts through the ContextBuilder pipeline.
   *
   * Creates a ContextBuilder from the story, adds runtime variables
   * (tiered context, chapter summaries, style guidance), then renders
   * through the Liquid template for the story's mode.
   */
  private async buildPrompts(
    entries: StoryEntry[],
    inlineImageMode: boolean,
    story: Story | null | undefined,
    worldState: NarrativeWorldState,
    worldStateArrays?: WorldStateArrays,
    styleReview?: StyleReviewResult | null,
    agenticRetrievalContext?: string | null,
    lorebookEntries?: ContextLorebookEntry[],
    timelineFillResult?: TimelineFillResult | null,
  ): Promise<{ systemPrompt: string; userMessage: string }> {
    const mode = story?.mode ?? 'adventure'

    // Create ContextBuilder -- forStory auto-populates mode, pov, tense, genre,
    // protagonistName, protagonistDescription, currentLocation, storyTime, etc.
    let ctx: ContextBuilder

    if (story?.id) {
      ctx = await ContextBuilder.forStory(story.id)
    } else {
      // Fallback for edge cases where story doesn't exist yet
      ctx = new ContextBuilder()
      ctx.add({
        mode,
        pov: story?.settings?.pov ?? 'second',
        tense: story?.settings?.tense ?? 'present',
        protagonistName: 'the protagonist',
      })
    }

    // Map story entries via mapper and add to context for template rendering
    const storyEntries = mapStoryEntriesToContext(entries, { stripPicTags: !inlineImageMode })
    ctx.add({ storyEntries })

    // Add runtime context variables for template rendering

    if (worldStateArrays) {
      ctx.add({ ...worldStateArrays })
    }

    if (lorebookEntries && lorebookEntries.length > 0) {
      ctx.add({ lorebookEntries })
    }
    if (agenticRetrievalContext) {
      ctx.add({ agenticRetrievalContext })
    }

    // Build chapter context arrays via mapper
    if (worldState.chapters && worldState.chapters.length > 0) {
      const { chapters, timelineFill } = mapChaptersToContext(
        worldState.chapters,
        timelineFillResult,
      )
      ctx.add({ chapters, timelineFill })
    }

    // Inject style review for template rendering
    if (styleReview && styleReview.phrases.length > 0) {
      ctx.add({ styleReview })
    }

    // Render through the mode-specific template -- user field comes from ${templateId}-user template
    const templateId = mode === 'creative-writing' ? 'creative-writing' : 'adventure'
    const { system: systemPrompt, user: userMessage } = await ctx.render(templateId)

    log('buildPrompts complete', {
      mode,
      templateId,
      systemPromptLength: systemPrompt.length,
      userMessageLength: userMessage.length,
    })

    return { systemPrompt, userMessage }
  }
}
