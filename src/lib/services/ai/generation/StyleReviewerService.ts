/**
 * Style Reviewer Service
 *
 * Analyzes text for repetitive phrases and style issues.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 */

import type { StoryEntry, StoryMode, POV, Tense } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { styleReviewResultSchema, type PhraseAnalysis } from '../sdk/schemas/style'
import type { ContextPassage } from '$lib/services/context/context-types'

const log = createLogger('StyleReviewer')

// Re-export PhraseAnalysis for consumers
export type { PhraseAnalysis }

// Full result type including metadata added by the service
// This extends the LLM output with reviewedEntryCount and timestamp
export interface StyleReviewResult {
  phrases: PhraseAnalysis[]
  overallAssessment: string
  reviewedEntryCount: number
  timestamp: number
}

/**
 * Service that analyzes text for style issues.
 */
export class StyleReviewerService extends BaseAIService {
  constructor(serviceId: string) {
    super(serviceId)
  }

  /**
   * Analyze narration entries for repetitive phrases and style issues.
   *
   * @param entries - Story entries to analyze (filters to narration only)
   * @param mode - Story mode for prompt context
   * @param pov - Point of view for prompt context
   * @param tense - Tense for prompt context
   */
  async analyzeStyle(
    entries: StoryEntry[],
    mode: StoryMode = 'adventure',
    pov: POV = 'second',
    tense: Tense = 'present',
  ): Promise<StyleReviewResult> {
    log('analyzeStyle', { entriesCount: entries.length })

    // Filter to narration entries only
    const narrationEntries = entries.filter((e) => e.type === 'narration')
    if (narrationEntries.length === 0) {
      return {
        phrases: [],
        overallAssessment: 'No narration entries to analyze.',
        reviewedEntryCount: 0,
        timestamp: Date.now(),
      }
    }

    // Build typed passages array for template iteration
    const passages: ContextPassage[] = narrationEntries.map((e) => ({
      content: e.content,
      entryId: e.id ?? '',
    }))

    const ctx = new ContextBuilder()
    ctx.add({
      mode,
      pov,
      tense,
      passageCount: narrationEntries.length.toString(),
      passages,
    })
    const { system, user: prompt } = await ctx.render('style-reviewer')

    try {
      const result = await this.generate(styleReviewResultSchema, system, prompt, 'style-reviewer')

      log('analyzeStyle complete', { phrasesFound: result.phrases.length })

      return {
        ...result,
        reviewedEntryCount: narrationEntries.length,
        timestamp: Date.now(),
      }
    } catch (error) {
      log('analyzeStyle failed', error)
      return {
        phrases: [],
        overallAssessment: 'Analysis failed.',
        reviewedEntryCount: narrationEntries.length,
        timestamp: Date.now(),
      }
    }
  }
}
