/**
 * Action Choices Service
 *
 * Generates action choices for adventure mode gameplay.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */

import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { story } from '$lib/stores/story/index.svelte'
import { createLogger } from '$lib/log'
import { actionChoicesResultSchema, type ActionChoice } from '../sdk/schemas/actionchoices'

const log = createLogger('ActionChoices')

/**
 * Service that generates action choices for adventure mode.
 */
export class ActionChoicesService extends BaseAIService {
  constructor(serviceId: string) {
    super(serviceId)
  }

  /**
   * Zero-arg overload: reads all context from storyContext singleton.
   * Used by the generation pipeline.
   */
  async generateChoices(): Promise<ActionChoice[]> {
    log('generateChoices called')

    let ctx = new ContextBuilder()

    // Add runtime variables for template rendering
    ctx.add(story.generationContext.promptContext)

    // Render through the action-choices template
    const { system, user: prompt } = await ctx.render('action-choices')

    try {
      const result = await this.generate(
        actionChoicesResultSchema,
        system,
        prompt,
        'action-choices',
      )

      log('Action choices generated:', result.choices.length)
      return result.choices.slice(0, 4)
    } catch (error) {
      log('Action choices generation failed:', error)
      return []
    }
  }
}
