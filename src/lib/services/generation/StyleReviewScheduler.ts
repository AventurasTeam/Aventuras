/**
 * StyleReviewScheduler - Handles style review scheduling logic extracted from ActionInput.svelte.
 * Manages counter state via callbacks and triggers review when threshold is met.
 */

import type { StoryEntry, StoryMode, POV, Tense } from '#lib/types/index.ts'
import type { StyleReviewResult } from '#lib/services/ai/generation/StyleReviewerService.ts'
import { createLogger } from '#lib/log.ts'
import {
  closeStep,
  failStep,
  NO_ACTIVITY,
  type ActivityReporter,
} from '#lib/services/activity/index.ts'

const log = createLogger('StyleReviewScheduler')

export interface StyleReviewCheckInput {
  storyId: string
  entries: StoryEntry[]
  mode: StoryMode
  pov: POV
  tense: Tense
  enabled: boolean
  triggerInterval: number
  recentEntriesCount: number
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
    recentEntriesCount: number,
    activityParentId?: string,
  ) => Promise<StyleReviewResult>
}

/** Where a due review records itself: a *Style review* step under `parentId`. */
export interface StyleReviewActivity {
  activity: ActivityReporter
  parentId: string
}

export interface StyleReviewUICallbacks {
  incrementCounter: () => void
  setLoading: (loading: boolean, storyId: string) => void
  setResult: (result: StyleReviewResult, storyId: string) => void
}

export interface StyleReviewCheckResult {
  triggered: boolean
  result?: StyleReviewResult
  /** The review was due and threw. */
  failed?: boolean
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
    reporting?: StyleReviewActivity,
  ): Promise<StyleReviewCheckResult> {
    const {
      storyId,
      entries,
      mode,
      pov,
      tense,
      enabled,
      triggerInterval,
      recentEntriesCount,
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
    // An empty parent would put the step at the root of the newest turn.
    const activity = reporting?.parentId ? reporting.activity : NO_ACTIVITY
    const stepId = activity.startStep('Style review', {
      parentId: reporting?.parentId,
      isLLM: true,
    })

    try {
      const result = await this.deps.analyzeStyle(
        entries,
        mode,
        pov,
        tense,
        recentEntriesCount,
        stepId || undefined,
      )
      closeStep(activity, stepId, result.failure)
      uiCallbacks?.setResult(result, storyId)
      log('Style review complete', { phrasesFound: result.phrases.length })
      return { triggered: true, result }
    } catch (error) {
      failStep(activity, stepId, error)
      log('Style review failed (non-fatal)', error)
      return { triggered: false, failed: true }
    } finally {
      uiCallbacks?.setLoading(false, storyId)
    }
  }
}
