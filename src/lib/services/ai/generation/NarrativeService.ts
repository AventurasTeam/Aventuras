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
import { story } from '$lib/stores/story/index.svelte'
import { mapContextResultToArrays } from '$lib/services/context/worldStateMapper'
import { EntryInjector } from './EntryInjector'
import { createLogger } from '$lib/log'
import type { StreamChunk } from '../core/types'

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
  async *stream(): AsyncIterable<StreamChunk> {
    // Build tiered context from singleton
    const injector = new EntryInjector({}, 'entryRetrieval')

    const contextResult = await injector.buildContext()
    mapContextResultToArrays(contextResult)

    const ctx = new ContextBuilder()

    ctx.add(story.generationContext.promptContext)

    // Render through the mode-specific template -- user field comes from ${templateId}-user template
    const templateId = story.mode === 'creative-writing' ? 'creative-writing' : 'adventure'
    const { system: systemPrompt, user: userMessage } = await ctx.render(templateId)

    try {
      const stream = streamNarrative({
        system: systemPrompt,
        prompt: userMessage,
        signal: story.generationContext.abortSignal,
      })

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
}
