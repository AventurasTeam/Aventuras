/**
 * Image Generation Utilities
 *
 * Helper functions for image generation using the standalone provider registry.
 */

import { generateImage, supportsImageGeneration } from './providers/registry'
import { database } from '$lib/services/database'
import { settings } from '$lib/stores/settings.svelte'
import type { StorySettings } from '$lib/types'
import { emitImageReady, emitImageAnalysisFailed } from '$lib/services/events'
import { createLogger } from '../core/config'

const log = createLogger('ImageUtils')

/**
 * Check if image generation is enabled and has valid configuration.
 * Now checks Image Profiles instead of API Profiles.
 */
export function isImageGenerationEnabled(
  storySettings?: StorySettings,
  type: 'standard' | 'background' | 'portrait' | 'reference' = 'standard',
): boolean {
  const imageSettings = settings.systemServicesSettings.imageGeneration

  if (storySettings) {
    if (type !== 'background' && storySettings.imageGenerationMode === 'none') return false
  } else {
    if (!imageSettings?.profileId) return false
  }

  // Determine which profileId to check based on type
  let profileId: string | null = imageSettings.profileId
  if (type === 'background') profileId = imageSettings.backgroundProfileId
  if (type === 'portrait') profileId = imageSettings.portraitProfileId
  if (type === 'reference') profileId = imageSettings.referenceProfileId

  if (!profileId) return false

  const profile = settings.getImageProfile(profileId)
  if (!profile) return false

  return supportsImageGeneration(profile.providerType)
}

/**
 * Check if required credentials are configured for image generation.
 */
export function hasRequiredCredentials(): boolean {
  const imageSettings = settings.systemServicesSettings.imageGeneration
  const profileId = imageSettings?.profileId
  if (!profileId) return false

  const profile = settings.getImageProfile(profileId)
  if (!profile) return false

  if (!supportsImageGeneration(profile.providerType)) return false

  return (
    !!profile.apiKey ||
    profile.providerType === 'pollinations' ||
    profile.providerType === 'comfyui'
  )
}

/**
 * Get display name for the currently configured image generation provider.
 */
export function getProviderDisplayName(): string {
  const imageSettings = settings.systemServicesSettings.imageGeneration
  const profileId = imageSettings?.profileId
  if (!profileId) return 'No provider'

  const profile = settings.getImageProfile(profileId)
  if (!profile) return 'Unknown'

  const names: Record<string, string> = {
    openai: 'OpenAI',
    nanogpt: 'NanoGPT',
    chutes: 'Chutes',
    pollinations: 'Pollinations.ai',
    google: 'Google',
    zhipu: 'Zhipu',
    comfyui: 'ComfyUI',
  }

  return names[profile.providerType] || profile.providerType
}

/**
 * Parse an image size string (e.g., "1024x1024" or "800x600") into width and height.
 * Falls back to 1024x1024 if the format is invalid.
 */
export function parseImageSize(size: string): { width: number; height: number } {
  try {
    const parts = size.toLowerCase().split('x')
    if (parts.length === 2) {
      const width = parseInt(parts[0], 10)
      const height = parseInt(parts[1], 10)
      if (!isNaN(width) && !isNaN(height)) {
        return { width, height }
      }
    }
  } catch (e) {
    log('Failed to parse image size', { size, error: e })
  }

  if (size === '512x512') return { width: 512, height: 512 }
  if (size === '2048x2048') return { width: 2048, height: 2048 }

  return { width: 1024, height: 1024 }
}

/**
 * Retry image generation for a failed/existing image using current settings.
 */
export async function retryImageGeneration(imageId: string, prompt: string): Promise<void> {
  if (!isImageGenerationEnabled()) {
    log('Cannot retry - image generation not enabled')
    return
  }

  const image = await database.getEmbeddedImage(imageId)
  if (!image) {
    log('Cannot retry - image not found', { imageId })
    return
  }

  const imageSettings = settings.systemServicesSettings.imageGeneration
  const profileId = imageSettings.profileId

  if (!profileId) {
    log('Cannot retry - no profile configured')
    return
  }

  const profile = settings.getImageProfile(profileId)
  const model = profile?.model ?? ''
  const size = imageSettings.size
  const { width, height } = parseImageSize(size)

  await database.updateEmbeddedImage(imageId, {
    prompt,
    model,
    status: 'generating',
    errorMessage: undefined,
    width,
    height,
  })

  log('Retrying image generation', { imageId, profileId, model, size })

  try {
    const result = await generateImage({ profileId, model, prompt, size })

    if (!result.base64) {
      throw new Error('No image data returned')
    }

    await database.updateEmbeddedImage(imageId, {
      imageData: result.base64,
      status: 'complete',
    })

    log('Image retry successful', { imageId })
    emitImageReady(imageId, image.entryId, true)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log('Image retry failed', { imageId, error: errorMessage })

    await database.updateEmbeddedImage(imageId, {
      status: 'failed',
      errorMessage,
    })

    emitImageReady(imageId, image.entryId, false)
    emitImageAnalysisFailed(image.entryId, errorMessage)
  }
}

/**
 * Generate a portrait image for a character.
 * Returns the base64 image data on success.
 */
export async function generatePortrait(prompt: string): Promise<string> {
  const imageSettings = settings.systemServicesSettings.imageGeneration

  const profileId = imageSettings.portraitProfileId
  if (!profileId) {
    throw new Error('No image generation profile configured')
  }

  const profile = settings.getImageProfile(profileId)
  const model = profile?.model ?? ''
  if (!model) {
    throw new Error('No image model configured')
  }

  const size = imageSettings.portraitSize || '1024x1024'

  log('Generating portrait', { profileId, model, size, promptLength: prompt.length })

  const result = await generateImage({ profileId, model, prompt, size })

  if (!result.base64) {
    throw new Error('No image data returned from provider')
  }

  return result.base64
}
