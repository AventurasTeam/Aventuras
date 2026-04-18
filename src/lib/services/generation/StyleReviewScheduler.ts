/**
 * StyleReviewScheduler - Handles style review scheduling logic extracted from ActionInput.svelte.
 * Manages counter state via callbacks and triggers review when threshold is met.
 */

import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import { aiService } from '../ai'
import { settings } from '$lib/stores/settings.svelte'
import { story } from '$lib/stores/story/index.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { createLogger } from '$lib/log'

const log = createLogger('StyleReviewScheduler')

export interface StyleReviewCheckInput {
  shouldIncrement: boolean
  source: string
}

export interface StyleReviewCheckResult {
  triggered: boolean
  result?: StyleReviewResult
}

export class StyleReviewScheduler {
  /**
   * Check if style review should be triggered and run it if threshold met.
   */
  async checkAndTrigger(input: StyleReviewCheckInput): Promise<StyleReviewCheckResult> {
    const enabled = settings.systemServicesSettings.styleReviewer.enabled
    const triggerInterval = settings.systemServicesSettings.styleReviewer.triggerInterval
    const storyId = story.id ?? ''
    const currentCounter = ui.messagesSinceLastStyleReview
    const { shouldIncrement, source } = input

    if (!enabled || !storyId) return { triggered: false }

    // Increment counter for new messages if requested
    let effectiveCounter = currentCounter
    if (shouldIncrement) {
      effectiveCounter = currentCounter + 1
      ui.incrementStyleReviewCounter()
    }

    log('Style review counter', {
      source,
      counter: effectiveCounter,
      triggerInterval,
      incremented: shouldIncrement,
    })

    if (effectiveCounter < triggerInterval) return { triggered: false }

    log('Triggering style review...')
    ui.setStyleReviewLoading(true, storyId)

    try {
      const result = await aiService.analyzeStyle()
      ui.setStyleReview(result, storyId)
      log('Style review complete', { phrasesFound: result.phrases.length })
      return { triggered: true, result }
    } catch (error) {
      log('Style review failed (non-fatal)', error)
      return { triggered: false }
    } finally {
      ui.setStyleReviewLoading(false, storyId)
    }
  }
}
