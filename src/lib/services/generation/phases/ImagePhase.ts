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
import { aiService, type ImageGenerationContext } from '$lib/services/ai'
import type { Character } from '$lib/types'
import type { ContextChatEntry } from '$lib/services/context/context-types'
import { story } from '$lib/stores/story/index.svelte'
import { mapChatEntries } from '$lib/services/context/classifierMapper'

/** Settings needed for image phase decision making */
export interface ImageSettings {
  imageGenerationMode?: 'none' | 'agentic' | 'inline'
  referenceMode?: boolean
}

/** Result from image phase */
export interface ImageResult {
  started: boolean
  skippedReason?: 'disabled' | 'agentic_generate_off' | 'not_configured' | 'aborted' | 'inline_mode'
}

/** Coordinates image generation. Errors are non-fatal. */
export class ImagePhase {
  /** Execute the image phase - yields events and returns result */
  async *execute(): AsyncGenerator<GenerationEvent, ImageResult> {
    yield { type: 'phase_start', phase: 'image' } satisfies PhaseStartEvent

    const imageSettings: ImageSettings = {
      imageGenerationMode: story.currentStory?.settings?.imageGenerationMode ?? 'agentic',
      referenceMode: story.currentStory?.settings?.referenceMode ?? false,
    }

    // Read all data from singleton
    const storyId = story.currentStory?.id ?? ''
    const entryId =
      story.generationContext.narrationEntryId ?? story.generationContext.userAction?.entryId ?? ''
    const narrativeContent = story.generationContext.narrativeResult?.content ?? ''
    const userAction = story.generationContext.userAction?.content ?? ''
    const abortSignal = story.generationContext.abortSignal ?? undefined

    // Compute presentCharacters from classification result
    const presentCharacterNames =
      story.generationContext.classificationResult?.classificationResult?.scene
        ?.presentCharacterNames ?? []
    const presentCharacters: Character[] = story.character.characters.filter((c) =>
      presentCharacterNames.includes(c.name),
    )

    const currentLocation = story.location.currentLocation?.name
    const chatHistory: ContextChatEntry[] = mapChatEntries(
      story.entry.visibleEntries.filter((e) => e.type === 'user_action' || e.type === 'narration'),
      { truncate: false, stripPicTags: true },
    )
    const translatedNarrative =
      story.generationContext.translationResult?.translatedContent ?? undefined
    const translationLanguage =
      story.generationContext.translationResult?.targetLanguage ?? undefined

    // Check if inline mode is enabled - inline images are processed during streaming, not here
    if (imageSettings.imageGenerationMode === 'inline') {
      const result: ImageResult = { started: false, skippedReason: 'inline_mode' }
      story.generationContext.imageResult = result
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    // Check if image generation is disabled for this story
    if (imageSettings.imageGenerationMode === 'none') {
      const result: ImageResult = { started: false, skippedReason: 'disabled' }
      story.generationContext.imageResult = result
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    // Check if auto-generate is off (manual mode - context stored for later)
    if (imageSettings.imageGenerationMode !== 'agentic') {
      const result: ImageResult = { started: false, skippedReason: 'agentic_generate_off' }
      story.generationContext.imageResult = result
      yield { type: 'phase_complete', phase: 'image', result } satisfies PhaseCompleteEvent
      return result
    }

    // Check if image generation is actually configured (profile exists)
    if (
      !aiService.isImageGenerationEnabled(imageSettings, 'standard') ||
      (imageSettings.referenceMode &&
        !aiService.isImageGenerationEnabled(imageSettings, 'reference'))
    ) {
      const result: ImageResult = { started: false, skippedReason: 'not_configured' }
      story.generationContext.imageResult = result
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
      await aiService.generateImagesForNarrative(imageGenContext)

      const result: ImageResult = { started: true }
      story.generationContext.imageResult = result
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
