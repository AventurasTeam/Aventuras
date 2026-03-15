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
import type { Character } from '$lib/types'
import type { ContextChatEntry } from '$lib/services/context/context-types'

/** Dependencies for image phase - injected to avoid tight coupling */
export interface ImageDependencies {
  generateImagesForNarrative: (context: ImageGenerationContext) => Promise<void>
  isImageGenerationEnabled: (
    storySettings?: any,
    type?: 'standard' | 'background' | 'portrait' | 'reference',
  ) => boolean
}

/** Settings needed for image phase decision making */
export interface ImageSettings {
  imageGenerationMode?: 'none' | 'agentic' | 'inline'
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
  chatHistory?: ContextChatEntry[]
  translatedNarrative?: string
  translationLanguage?: string
  imageSettings: ImageSettings
  abortSignal?: AbortSignal
}

/** Result from image phase */
export interface ImageResult {
  started: boolean
  skippedReason?: 'disabled' | 'agentic_generate_off' | 'not_configured' | 'aborted' | 'inline_mode'
}

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

    // Check if auto-generate is off (manual mode - context stored for later)
    if (imageSettings.imageGenerationMode !== 'agentic') {
      const result: ImageResult = { started: false, skippedReason: 'agentic_generate_off' }
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
    const imageGenContext: ImageGenerationContext = {
      storyId,
      entryId,
      narrativeResponse: narrativeContent,
      userAction,
      presentCharacters,
      currentLocation,
      chatHistory,
      translatedNarrative,
      translationLanguage,
      referenceMode: imageSettings.referenceMode || false,
    }

    try {
      // Start image generation (runs in background via AIService)
      // Note: This is intentionally fire-and-forget within the pipeline
      // The AIService handles its own error logging
      await this.deps.generateImagesForNarrative(imageGenContext)

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
