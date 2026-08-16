/**
 * BackgroundImagePhase - Handles background image generation
 *
 * Asks the background analyser whether the scene changed enough to warrant a new
 * background, and lets it generate one. Skipped entirely in inline mode, where images come
 * from <pic> tags during streaming rather than from scene analysis.
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  AbortedEvent,
  ErrorEvent,
} from '../types'
import type { StoryEntry, ImageGenerationMode } from '$lib/types'

/** Dependencies for image phase - injected to avoid tight coupling */
export interface BackgroundImageDependencies {
  analyzeBackgroundChangeAndGenerateImage: (
    storyId: string,
    visibleEntries: StoryEntry[],
  ) => Promise<void>
  isImageGenerationEnabled: (
    storySettings?: any,
    type?: 'standard' | 'background' | 'portrait' | 'reference',
  ) => boolean
}

/** Settings needed for image phase decision making */
export interface BackgroundImageSettings {
  backgroundImagesEnabled?: boolean
  imageGenerationMode?: ImageGenerationMode
}

/** Input for the image phase */
export interface BackgroundImageInput {
  storyId: string
  storyEntries: StoryEntry[]
  imageSettings: BackgroundImageSettings
  abortSignal?: AbortSignal
}

/** Result from image phase */
export interface BackgroundImageResult {
  started: boolean
  skippedReason?: 'disabled' | 'auto_generate_off' | 'not_configured' | 'aborted' | 'inline_mode'
}

/** Coordinates image generation. Errors are non-fatal. */
export class BackgroundImagePhase {
  constructor(private deps: BackgroundImageDependencies) {}

  /** Execute the image phase - yields events and returns result */
  async *execute(
    input: BackgroundImageInput,
  ): AsyncGenerator<GenerationEvent, BackgroundImageResult> {
    yield { type: 'phase_start', phase: 'image' } satisfies PhaseStartEvent

    const { storyId, storyEntries, imageSettings, abortSignal } = input

    // Check if background image generation is disabled
    if (imageSettings.backgroundImagesEnabled === false) {
      const result: BackgroundImageResult = { started: false, skippedReason: 'disabled' }
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    // Skip in inline mode - we don't want agentic background analysis in pure inline mode
    if (imageSettings.imageGenerationMode === 'inline') {
      const result: BackgroundImageResult = { started: false, skippedReason: 'inline_mode' }
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    // Check if image generation is actually configured (profile exists)
    if (!this.deps.isImageGenerationEnabled(imageSettings, 'background')) {
      const result: BackgroundImageResult = { started: false, skippedReason: 'not_configured' }
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'image' } satisfies AbortedEvent
      return { started: false, skippedReason: 'aborted' }
    }

    try {
      await this.deps.analyzeBackgroundChangeAndGenerateImage(storyId, storyEntries)

      const result: BackgroundImageResult = { started: true }
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
