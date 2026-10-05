/**
 * ImagePhase - Handles image generation coordination
 * Supports inline (<pic> tags) and analyzed (LLM scene detection) modes.
 * Uses interchangeable profiles - this phase does NOT change that architecture.
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  AbortedEvent,
  ErrorEvent,
} from '../types'
import type { ImageGenerationContext } from '$lib/services/ai'
import type { Character, ImageGenerationMode } from '$lib/types'
import type { ActivityReporter } from '$lib/services/activity'

type PhaseImageContext = Omit<
  ImageGenerationContext,
  'branchId' | 'getCharacters' | 'onPortraitGenerated'
>

/** Dependencies for image phase - injected to avoid tight coupling */
export interface ImageDependencies {
  generateImagesForNarrative: (
    context: PhaseImageContext,
  ) => Promise<{ queued: number; failure?: string }>
  isImageGenerationEnabled: (
    storySettings?: any,
    type?: 'standard' | 'background' | 'portrait' | 'reference',
  ) => boolean
}

/** Settings needed for image phase decision making */
export interface ImageSettings {
  imageGenerationMode: ImageGenerationMode
  referenceMode?: boolean
}

/** Input for the image phase */
export interface ImageInput {
  storyId: string
  entryId: string
  narrativeContent: string
  userAction: string
  presentCharacters: Character[]
  currentLocation?: string
  chatHistory?: string
  lorebookContext?: string
  translatedNarrative?: string
  translationLanguage?: string
  imageSettings: ImageSettings
  abortSignal?: AbortSignal
  activity?: ActivityReporter
  /** Step the image work nests under. */
  activityParentId?: string
}

/** Result from image phase */
export interface ImageResult {
  started: boolean
  skippedReason?: 'disabled' | 'not_configured' | 'aborted' | 'inline_mode'
}

const queuedImages = (count: number) =>
  count === 0 ? 'no images queued' : `${count} image${count === 1 ? '' : 's'} queued`

/** Coordinates image generation. Errors are non-fatal. */
export class ImagePhase {
  constructor(private deps: ImageDependencies) {}

  /** Execute the image phase - yields events and returns result */
  async *execute(input: ImageInput): AsyncGenerator<GenerationEvent, ImageResult> {
    yield { type: 'phase_start', phase: 'image' } satisfies PhaseStartEvent

    const {
      storyId,
      entryId,
      narrativeContent,
      userAction,
      presentCharacters,
      currentLocation,
      chatHistory,
      lorebookContext,
      translatedNarrative,
      translationLanguage,
      imageSettings,
      abortSignal,
    } = input

    // Check if inline mode is enabled - inline images are processed during streaming, not here
    if (imageSettings.imageGenerationMode === 'inline') {
      const result: ImageResult = { started: false, skippedReason: 'inline_mode' }
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    // Check if image generation is disabled for this story
    if (imageSettings.imageGenerationMode === 'none') {
      const result: ImageResult = { started: false, skippedReason: 'disabled' }
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    // Check if image generation is actually configured (profile exists)
    if (
      !this.deps.isImageGenerationEnabled(imageSettings, 'standard') ||
      (imageSettings.referenceMode &&
        !this.deps.isImageGenerationEnabled(imageSettings, 'reference'))
    ) {
      const result: ImageResult = { started: false, skippedReason: 'not_configured' }
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'image' } satisfies AbortedEvent
      return { started: false, skippedReason: 'aborted' }
    }

    // Build the image generation context
    const imageGenContext: PhaseImageContext = {
      storyId,
      entryId,
      narrativeResponse: narrativeContent,
      userAction,
      presentCharacters,
      currentLocation,
      chatHistory,
      lorebookContext,
      translatedNarrative,
      translationLanguage,
      referenceMode: imageSettings.referenceMode || false,
      imageGenerationMode: imageSettings.imageGenerationMode,
      activityParentId: input.activityParentId,
    }

    try {
      // Start image generation (runs in background via AIService)
      // Note: This is intentionally fire-and-forget within the pipeline
      // The AIService handles its own error logging
      const outcome = await this.deps.generateImagesForNarrative(imageGenContext)
      // An absorbed failure is already on the step that met it; nothing was handed off.
      if (!outcome.failure && input.activityParentId) {
        // The images finish after the turn; the record notes the hand-off, not their progress.
        input.activity?.recordStep('Handed off', {
          parentId: input.activityParentId,
          detail: queuedImages(outcome.queued),
        })
      }

      const result: ImageResult = { started: true }
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'aborted', phase: 'image' } satisfies AbortedEvent
        return { started: false, skippedReason: 'aborted' }
      }

      // Image generation errors are non-fatal
      yield {
        type: 'error',
        phase: 'image',
        error: error instanceof Error ? error : new Error(String(error)),
        fatal: false,
      } satisfies ErrorEvent

      return { started: false }
    }
  }
}
