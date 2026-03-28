/**
 * Suggestions Service
 *
 * Generates story direction suggestions for creative writing mode.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */

import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { suggestionsResultSchema, type SuggestionsResult } from '../sdk/schemas/suggestions'
import { story } from '$lib/stores/story/index.svelte'

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
   * Zero-arg overload: reads all context from storyContext singleton.
   * Used by the generation pipeline.
   */
  async generateSuggestions(): Promise<SuggestionsResult> {
    log('generateSuggestions called')

    // Create ContextBuilder -- use forStory when storyId available
    const ctx = new ContextBuilder()
    ctx.add(story.generationContext.promptContext)

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
