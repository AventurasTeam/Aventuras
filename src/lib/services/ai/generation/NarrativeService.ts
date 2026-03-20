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

import { streamNarrative } from '../sdk/generate'
import { ContextBuilder } from '$lib/services/context'
import { mapChaptersToContext } from '$lib/services/context/chapterMapper'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'
import { story } from '$lib/stores/story/index.svelte'
import { ui } from '$lib/stores/ui.svelte'
import {
  mapContextResultToArrays,
  type WorldStateArrays,
} from '$lib/services/context/worldStateMapper'
import { EntryInjector } from './EntryInjector'
import { createLogger } from '$lib/log'
import type { StreamChunk } from '../core/types'
import type { Story, StoryEntry } from '$lib/types'
import type { StyleReviewResult } from './StyleReviewerService'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'
import type { AgenticRetrievalFields } from '$lib/services/generation/types'
import type { StoryChapterStore } from '$lib/stores/story/chapter.svelte'

const log = createLogger('Narrative')

/**
 * Options for streaming narrative generation.
 * All story data is read from the storyContext singleton.
 */
export interface NarrativeOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal
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
   * Stream a narrative response (zero-arg).
   *
   * Reads all story data from the storyContext singleton.
   * This is the primary method used by the UI for real-time narrative generation.
   * Yields StreamChunk objects as text arrives from the model.
   */
  async *stream(signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const entries = story.entry.visibleEntries
    const retrievalResult = story.generationContext.retrievalResult
    const agenticRetrieval = retrievalResult?.agenticRetrieval ?? null
    const lorebookEntries = retrievalResult?.lorebookEntries ?? []
    const styleReview = ui.lastStyleReview

    log('stream', {
      entriesCount: entries.length,
      hasAgenticContext: !!agenticRetrieval,
      lorebookEntriesCount: lorebookEntries.length,
    })

    // Build tiered context from singleton
    const lastEntry = entries[entries.length - 1]
    const userInput = lastEntry?.content ?? ''
    const injector = new EntryInjector({}, 'entryRetrieval')
    const worldState = {
      characters: story.character.characters,
      locations: story.location.locations,
      items: story.item.items,
      storyBeats: story.storyBeat.storyBeats,
      currentLocation: story.location.currentLocation,
      chapters: story.chapter.currentBranchChapters,
    }
    const contextResult = await injector.buildContext(worldState, userInput, entries)
    const worldStateArrays = mapContextResultToArrays(contextResult)

    const inlineImageMode = story?.currentStory?.settings?.imageGenerationMode === 'inline'

    const { systemPrompt, userMessage } = await this.buildPrompts(
      entries,
      inlineImageMode,
      story.currentStory,
      worldStateArrays,
      agenticRetrieval,
      lorebookEntries,
      styleReview,
      story.chapter.currentBranchChapters,
    )

    try {
      const stream = streamNarrative({ system: systemPrompt, prompt: userMessage, signal })

      for await (const part of stream.fullStream) {
        if (part.type === 'reasoning-delta') {
          yield { content: '', reasoning: (part as { text?: string }).text, done: false }
        } else if (part.type === 'text-delta') {
          yield { content: (part as { text?: string }).text || '', done: false }
        }
      }

      yield { content: '', done: true }
    } catch (error) {
      log('stream error', error)
      throw error
    }
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
    worldStateArrays?: WorldStateArrays,
    agenticRetrieval?: AgenticRetrievalFields | null,
    lorebookEntries?: ContextLorebookEntry[],
    styleReview?: StyleReviewResult | null,
    currentBranchChapters?: StoryChapterStore['currentBranchChapters'],
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
    if (agenticRetrieval) {
      ctx.add({
        agenticReasoning: agenticRetrieval.agenticReasoning,
        agenticChapterSummary: agenticRetrieval.agenticChapterSummary,
        agenticSelectedEntries: agenticRetrieval.agenticSelectedEntries,
      })
    }

    // Build chapter context arrays via zero-arg overload (reads from singleton)
    if (currentBranchChapters && currentBranchChapters.length > 0) {
      const { chapters, timelineFill } = mapChaptersToContext()
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
