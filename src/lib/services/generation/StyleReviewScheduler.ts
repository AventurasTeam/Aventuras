/**
 * StyleReviewScheduler - Handles style review scheduling logic extracted from ActionInput.svelte.
 * Manages counter state via callbacks and triggers review when threshold is met.
 */

import type { StoryEntry, StoryMode, POV, Tense } from '$lib/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import { createLogger } from '$lib/log'

const log = createLogger('StyleReviewScheduler')

export interface StyleReviewCheckInput {
  storyId: string
  entries: StoryEntry[]
  mode: StoryMode
  pov: POV
  tense: Tense
  enabled: boolean
  triggerInterval: number
  currentCounter: number
  shouldIncrement: boolean
  source: string
}

export interface StyleReviewDependencies {
  analyzeStyle: (
    entries: StoryEntry[],
    mode: StoryMode,
    pov: POV,
    tense: Tense,
  ) => Promise<StyleReviewResult>
}

export interface StyleReviewUICallbacks {
  incrementCounter: () => void
  setLoading: (loading: boolean, storyId: string) => void
  setResult: (result: StyleReviewResult, storyId: string) => void
}

export interface StyleReviewCheckResult {
  triggered: boolean
  result?: StyleReviewResult
}

export class StyleReviewScheduler {
  private deps: StyleReviewDependencies

  constructor(deps: StyleReviewDependencies) {
    this.deps = deps
  }

  /**
   * Check if style review should be triggered and run it if threshold met.
   */
  async checkAndTrigger(
    input: StyleReviewCheckInput,
    uiCallbacks?: StyleReviewUICallbacks,
  ): Promise<StyleReviewCheckResult> {
    const {
      storyId,
      entries,
      mode,
      pov,
      tense,
      enabled,
      triggerInterval,
      currentCounter,
      shouldIncrement,
      source,
    } = input

    if (!enabled || !storyId) return { triggered: false }

    // Increment counter for new messages if requested
    let effectiveCounter = currentCounter
    if (shouldIncrement) {
      effectiveCounter = currentCounter + 1
      uiCallbacks?.incrementCounter()
    }

    log('Style review counter', {
      source,
      storyId,
      counter: effectiveCounter,
      triggerInterval,
      incremented: shouldIncrement,
    })

    if (effectiveCounter < triggerInterval) return { triggered: false }

    log('Triggering style review...')
    uiCallbacks?.setLoading(true, storyId)

    try {
      const result = await this.deps.analyzeStyle(entries, mode, pov, tense)
      uiCallbacks?.setResult(result, storyId)
      log('Style review complete', { phrasesFound: result.phrases.length })
      return { triggered: true, result }
    } catch (error) {
      log('Style review failed (non-fatal)', error)
      return { triggered: false }
    } finally {
      uiCallbacks?.setLoading(false, storyId)
    }
  }
}
