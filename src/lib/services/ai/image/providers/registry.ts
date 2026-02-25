/**
 * Image Provider Registry
 *
 * Central dispatcher for image generation. Resolves ImageProfile → provider,
 * delegates generate/listModels calls. Drop-in replacement for the old
 * sdk/generate.ts generateImage().
 */

import { settings } from '$lib/stores/settings.svelte'
import type { ImageProviderType } from '$lib/types'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { createLogger } from '../../core/config'

// Provider factory imports (lazy)
import { createNanoGPTProvider } from './nanogpt'
import { createOpenAIProvider } from './openai'
import { createChutesProvider } from './chutes'
import { createPollinationsProvider } from './pollinations'
import { createGoogleProvider } from './google'
import { createZhipuProvider } from './zhipu'
import { createComfyProvider } from './comfy'

const log = createLogger('ImageRegistry')

// ============================================================================
// Provider Factories
// ============================================================================

type ProviderFactory = (config: ImageProviderConfig) => ImageProvider

const PROVIDER_FACTORIES: Record<ImageProviderType, ProviderFactory> = {
  nanogpt: createNanoGPTProvider,
  openai: createOpenAIProvider,
  chutes: createChutesProvider,
  pollinations: createPollinationsProvider,
  google: createGoogleProvider,
  zhipu: createZhipuProvider,
  comfyui: createComfyProvider,
}

// ============================================================================
// Model Cache
// ============================================================================

interface ModelCache {
  models: ImageModelInfo[]
  timestamp: number
}

const CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const modelCaches = new Map<string, ModelCache>()

function getCacheKey(providerType: ImageProviderType, apiKey?: string): string {
  const keyHash = apiKey ? apiKey.slice(-8) : 'nokey'
  return `${providerType}:${keyHash}`
}

export function clearModelsCache(): void {
  modelCaches.clear()
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if a provider type supports image generation.
 */
export function supportsImageGeneration(providerType: string): boolean {
  return providerType in PROVIDER_FACTORIES
}

/**
 * Generate an image using an Image Profile.
 * Drop-in replacement for the old sdk/generate.ts generateImage().
 */
export async function generateImage(options: {
  profileId: string
  model: string
  prompt: string
  size?: string
  referenceImages?: string[]
  signal?: AbortSignal
}): Promise<ImageGenerateResult> {
  const { profileId, model, prompt, size = '1024x1024', referenceImages, signal } = options

  const profile = settings.getImageProfile(profileId)
  if (!profile) {
    throw new Error(`Image profile not found: ${profileId}`)
  }

  if (!PROVIDER_FACTORIES[profile.providerType]) {
    throw new Error(`Unknown image provider type: ${profile.providerType}`)
  }

  log('generateImage', {
    profileId,
    model,
    providerType: profile.providerType,
    hasReferences: !!referenceImages?.length,
  })

  const config: ImageProviderConfig = {
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    providerOptions: profile.providerOptions,
  }

  const provider = PROVIDER_FACTORIES[profile.providerType](config)

  // Strip data: prefix from reference images if present
  const cleanRefs = referenceImages?.map((img) =>
    img.startsWith('data:') ? img.replace(/^data:image\/[^;]+;base64,/, '') : img,
  )

  return provider.generate({
    model,
    prompt,
    size,
    referenceImages: cleanRefs,
    signal,
    providerOptions: profile.providerOptions,
  })
}

/**
 * List available image models for an Image Profile.
 */
export async function listImageModels(profileId: string): Promise<ImageModelInfo[]> {
  const profile = settings.getImageProfile(profileId)
  if (!profile) return []

  const cacheKey = getCacheKey(profile.providerType, profile.apiKey)
  const cached = modelCaches.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.models
  }

  try {
    const config: ImageProviderConfig = {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl,
    }
    const provider = PROVIDER_FACTORIES[profile.providerType](config)
    const models = await provider.listModels(profile.apiKey)
    modelCaches.set(cacheKey, { models, timestamp: Date.now() })
    return models
  } catch (error) {
    log('Error listing models', { providerType: profile.providerType, error })
    return []
  }
}

/**
 * List image models by provider type directly (without needing a profile).
 * Used during profile creation to preview available models.
 */
export async function listImageModelsByProvider(
  providerType: ImageProviderType,
  apiKey?: string,
): Promise<ImageModelInfo[]> {
  const cacheKey = getCacheKey(providerType, apiKey)
  const cached = modelCaches.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.models
  }

  try {
    const config: ImageProviderConfig = { apiKey: apiKey ?? '' }
    const provider = PROVIDER_FACTORIES[providerType](config)
    const models = await provider.listModels(apiKey)
    modelCaches.set(cacheKey, { models, timestamp: Date.now() })
    return models
  } catch (error) {
    log('Error listing models by provider', { providerType, error })
    return []
  }
}

/**
 * Get sampler info for a ComfyUI provider.
 */
export async function getComfySamplerInfo(
  baseUrl?: string,
): Promise<{ samplers: string[]; schedulers: string[] }> {
  try {
    const config: ImageProviderConfig = { apiKey: '', baseUrl }
    const provider = createComfyProvider(config)
    if (provider.getSamplerInfo) {
      return await provider.getSamplerInfo()
    }
    return { samplers: [], schedulers: [] }
  } catch (error) {
    log('Error getting sampler info', { error })
    return { samplers: [], schedulers: [] }
  }
}

/**
 * List available LoRAs for a ComfyUI provider.
 */
export async function listLoras(baseUrl?: string): Promise<string[]> {
  try {
    const config: ImageProviderConfig = { apiKey: '', baseUrl }
    const provider = createComfyProvider(config)
    if (provider.listLoras) {
      return await provider.listLoras()
    }
    return []
  } catch (error) {
    log('Error getting LoRA list', { error })
    return []
  }
}

// Re-export types for convenience
export type { ImageModelInfo, ImageGenerateResult } from './types'
