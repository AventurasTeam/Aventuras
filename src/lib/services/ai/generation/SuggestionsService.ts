/**
 * Suggestions Service
 *
 * Generates story direction suggestions for creative writing mode.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */

import type { StoryEntry, StoryBeat } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { createLogger, getContextConfig, getLorebookConfig } from '../core/config'
import { suggestionsResultSchema, type SuggestionsResult } from '../sdk/schemas/suggestions'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'
import { prepareLorebookForContext } from '$lib/services/context/lorebookMapper'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'

const log = createLogger('Suggestions')

/**
 * Service for generating story direction suggestions.
 *
 * This service has been refactored to use the Vercel AI SDK with Zod schemas
 * for automatic output validation. The constructor no longer requires a provider.
 */
export class SuggestionsService extends BaseAIService {
  /**
   * Create a new SuggestionsService.
   * @param serviceId - The service ID used to resolve the preset dynamically
   */
  constructor(serviceId: string) {
    super(serviceId)
  }

  /**
   * Generate story direction suggestions for creative writing mode.
   * Per design doc section 4.2: Suggestions System
   *
   * @param recentEntries - Recent story entries for context
   * @param activeThreads - Active story beats/threads
   * @param lorebookEntries - Optional lorebook entries for world context
   * @param storyId - Story ID for ContextBuilder (optional, falls back to manual context)
   * @param latestNarrativeResponse - Latest generated narration (optional, used when entries are stale)
   */
  async generateSuggestions(
    recentEntries: StoryEntry[],
    activeThreads: StoryBeat[],
    lorebookEntries?: ContextLorebookEntry[],
    storyId?: string,
    latestNarrativeResponse?: string,
  ): Promise<SuggestionsResult> {
    log('generateSuggestions called', {
      recentEntriesCount: recentEntries.length,
      activeThreadsCount: activeThreads.length,
      hasStoryId: !!storyId,
      lorebookEntriesCount: lorebookEntries?.length ?? 0,
      hasLatestNarrativeResponse: !!latestNarrativeResponse?.trim(),
    })

    // Get the last few entries for context
    const contextConfig = getContextConfig()
    const lorebookConfig = getLorebookConfig()
    const lastEntries = recentEntries.slice(-contextConfig.recentEntriesForRetrieval)

    // Append latest narrative if it differs from the last narration entry (preserves current behavior)
    const entriesToMap = [...lastEntries]
    const latestNarrative = latestNarrativeResponse?.trim()
    if (latestNarrative) {
      const lastNarrativeInEntries = [...lastEntries]
        .reverse()
        .find((e) => e.type === 'narration')
        ?.content?.trim()

      if (lastNarrativeInEntries !== latestNarrative) {
        entriesToMap.push({ type: 'narration', content: latestNarrative } as StoryEntry)
      }
    }

    const storyEntries = mapStoryEntriesToContext(entriesToMap, {
      stripPicTags: true,
    })

    // Format active threads
    const activeThreadsStr =
      activeThreads.length > 0
        ? activeThreads
            .map((t) => `• ${t.title}${t.description ? `: ${t.description}` : ''}`)
            .join('\n')
        : '(none)'

    // Prepare lorebook entries using structured mapper
    const preparedLorebook = prepareLorebookForContext(
      lorebookEntries ?? [],
      lorebookConfig.maxForSuggestions,
    )

    // Create ContextBuilder -- use forStory when storyId available
    let ctx: ContextBuilder
    if (storyId) {
      ctx = await ContextBuilder.forStory(storyId)
    } else {
      ctx = new ContextBuilder()
      ctx.add({
        mode: 'creative-writing',
        pov: 'third',
        tense: 'past',
        protagonistName: 'the protagonist',
      })
    }

    // Build genre string from context
    const ctxData = ctx.getContext()
    const genreStr = ctxData.genre ? `## Genre: ${ctxData.genre}\n` : ''

    // Add runtime variables for template rendering
    ctx.add({
      storyEntries,
      activeThreads: activeThreadsStr,
      genre: genreStr,
    })
    if (preparedLorebook.length > 0) {
      ctx.add({ lorebookEntries: preparedLorebook })
    }

    // Render through the suggestions template
    const { system, user: prompt } = await ctx.render('suggestions')

    try {
      // Use SDK's generateStructured - all boilerplate handled automatically
      const result = await this.generate(suggestionsResultSchema, system, prompt, 'suggestions')

      log('Suggestions generated:', result.suggestions.length)
      return result
    } catch (error) {
      log('Suggestions generation failed:', error)
      return { suggestions: [] }
    }
  }
}
