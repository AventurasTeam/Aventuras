/**
 * Image Provider Registry
 *
 * Central dispatcher for image generation. Resolves ImageProfile → provider,
 * delegates generate/listModels calls. Drop-in replacement for the old
 * sdk/generate.ts generateImage().
 */

import { settings } from '#lib/stores/settings.svelte.ts'
import type { ImageModelCapabilities, ImageProfile, ImageProviderType } from '#lib/types/index.ts'
import { parseImageSpec, describeImageSpec, type ImageSpec } from '#lib/utils/image.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { createLogger } from '#lib/log.ts'
import { fetchPublicImageBase64 } from './fetchAdapter'
import { IMAGE_MODEL_SNAPSHOT_VERSION, snapshotModel } from './modelSnapshot'

// Provider factory imports (lazy)
import { createNanoGPTProvider } from './nanogpt'
import { createOpenAIProvider, openaiModelCapabilities } from './openai'
import { createOpenAICompatibleProvider } from './openaiCompatibleProvider'
import { createPollinationsProvider } from './pollinations'
import { createGoogleProvider, googleModelCapabilities } from './google'
import { createZhipuProvider } from './zhipu'
import { comfyReferenceLimit, createComfyProvider } from './comfy'
import { createOpenRouterProvider } from './openrouter'
import { a1111ReferenceLimit, createA1111Provider } from './a1111'

const log = createLogger('ImageRegistry')

// ============================================================================
// Provider Factories
// ============================================================================

type ProviderFactory = (config: ImageProviderConfig) => ImageProvider

const PROVIDER_FACTORIES: Record<ImageProviderType, ProviderFactory> = {
  nanogpt: createNanoGPTProvider,
  openai: createOpenAIProvider,
  'openai-compatible': createOpenAICompatibleProvider,
  openrouter: createOpenRouterProvider,
  pollinations: createPollinationsProvider,
  google: createGoogleProvider,
  zhipu: createZhipuProvider,
  comfyui: createComfyProvider,
  a1111: createA1111Provider,
}

export const IMAGE_PROVIDER_LABELS: Record<ImageProviderType, string> = {
  nanogpt: 'NanoGPT',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI Compatible',
  openrouter: 'OpenRouter',
  pollinations: 'Pollinations',
  google: 'Google AI Studio',
  zhipu: 'Z.AI',
  comfyui: 'ComfyUI',
  a1111: 'A1111 / SD.cpp / Kobold',
}

type FieldMode = 'required' | 'optional' | 'none'

/**
 * How a provider uses an API key: `required` for the hosted ones, `optional` for an endpoint
 * the user runs or fronts themselves, `none` for the ones that run on the user's own machine.
 * Exhaustive by type, so a new provider has to declare which it is.
 *
 * Pollinations counts as requiring one: the model list is served without it, but
 * generation is not, and a profile that can list and cannot draw is the worse failure —
 * it looks configured.
 */
const PROVIDER_API_KEY: Record<ImageProviderType, FieldMode> = {
  nanogpt: 'required',
  openai: 'required',
  'openai-compatible': 'optional',
  openrouter: 'required',
  google: 'required',
  zhipu: 'required',
  pollinations: 'required',
  comfyui: 'none',
  a1111: 'none',
}

/** Whether a provider takes a base URL: `required` when it has no endpoint of its own to default to. */
const PROVIDER_BASE_URL: Record<ImageProviderType, FieldMode> = {
  nanogpt: 'none',
  openai: 'optional',
  'openai-compatible': 'required',
  openrouter: 'none',
  google: 'none',
  zhipu: 'optional',
  pollinations: 'none',
  comfyui: 'optional',
  a1111: 'optional',
}

const unlimited = () => Infinity

/** How many references the adapter sends; 0 skips the download. */
const PROVIDER_REFERENCE_LIMIT: Record<
  ImageProviderType,
  (providerOptions: ImageProfile['providerOptions']) => number
> = {
  nanogpt: unlimited,
  openai: unlimited,
  'openai-compatible': unlimited,
  openrouter: unlimited,
  pollinations: unlimited,
  google: unlimited,
  zhipu: () => 0,
  comfyui: comfyReferenceLimit,
  a1111: a1111ReferenceLimit,
}

/** How many references a profile of this provider type sends; 0 means none. */
export const referenceLimit = (
  providerType: ImageProviderType,
  providerOptions: ImageProfile['providerOptions'],
): number => PROVIDER_REFERENCE_LIMIT[providerType](providerOptions)

type CapabilitySource =
  | { kind: 'snapshot' }
  | { kind: 'table'; lookup: (model: string) => ImageModelCapabilities | undefined }
  | { kind: 'none' }

/**
 * Where a provider's per-model capabilities come from at generation: `snapshot` for an API that
 * can change under a saved profile, `table` for a map in the adapter, `none` for nothing that
 * generation reads. Exhaustive by type, so a new provider has to declare which it is.
 */
const PROVIDER_CAPABILITIES: Record<ImageProviderType, CapabilitySource> = {
  nanogpt: { kind: 'snapshot' },
  openai: { kind: 'table', lookup: openaiModelCapabilities },
  'openai-compatible': { kind: 'snapshot' },
  openrouter: { kind: 'snapshot' },
  pollinations: { kind: 'snapshot' },
  google: { kind: 'table', lookup: googleModelCapabilities },
  zhipu: { kind: 'none' },
  comfyui: { kind: 'none' },
  a1111: { kind: 'none' },
}

/** Whether a profile of this provider type saves a snapshot of its model's capabilities. */
export const capturesModelSnapshot = (providerType: ImageProviderType): boolean =>
  PROVIDER_CAPABILITIES[providerType].kind === 'snapshot'

// ============================================================================
// Model Cache
// ============================================================================

interface ModelCache {
  models: ImageModelInfo[]
  timestamp: number
}

const CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const modelCaches = new Map<string, ModelCache>()

function getCacheKey(providerType: ImageProviderType, apiKey?: string, baseUrl?: string): string {
  const keyHash = apiKey ? apiKey.slice(-8) : 'nokey'
  const urlKey = normalizeBaseUrl(baseUrl) || 'nourl'
  return `${providerType}:${keyHash}:${urlKey}`
}

// ============================================================================
// Model Capabilities
// ============================================================================

const BACKFILL_TIMEOUT_MS = 10_000
const failedBackfills = new Set<string>()
const pendingBackfills = new Map<string, Promise<ImageModelCapabilities | undefined>>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** What a profile's model can do, from the source its provider declares. */
async function modelCapabilities(
  profile: ImageProfile,
  model: string,
): Promise<ImageModelCapabilities | undefined> {
  const source = PROVIDER_CAPABILITIES[profile.providerType]
  switch (source.kind) {
    case 'table':
      return source.lookup(model)
    case 'none':
      return undefined
    case 'snapshot':
      return snapshotCapabilities(profile, model)
    default: {
      const unreachable: never = source
      return unreachable
    }
  }
}

/** From the profile's snapshot; a legacy or outdated one is looked up once. */
async function snapshotCapabilities(
  profile: ImageProfile,
  model: string,
): Promise<ImageModelCapabilities | undefined> {
  const snapshot = profile.modelSnapshot?.model === model ? profile.modelSnapshot : undefined
  if (snapshot?.version === IMAGE_MODEL_SNAPSHOT_VERSION) return snapshot.capabilities

  const key = `${profile.id}:${model}`
  if (failedBackfills.has(key)) return snapshot?.capabilities

  const pending = pendingBackfills.get(key)
  if (pending) return pending

  const lookup = (async () => {
    try {
      const found = await withTimeout(
        lookupModelCapabilities(profile.providerType, profile.apiKey, model, profile.baseUrl),
        BACKFILL_TIMEOUT_MS,
      )
      const next = snapshotModel(model, found)
      const current = settings.getImageProfile(profile.id)
      if (
        current?.model === model &&
        current.providerType === profile.providerType &&
        current.apiKey === profile.apiKey &&
        normalizeBaseUrl(current.baseUrl) === normalizeBaseUrl(profile.baseUrl)
      ) {
        try {
          await settings.updateImageProfile(profile.id, { modelSnapshot: next })
        } catch (error) {
          log('Error saving model snapshot', { profileId: profile.id, error })
        }
      }
      return next.capabilities
    } catch (error) {
      log('Error looking up model capabilities', { profileId: profile.id, model, error })
      failedBackfills.add(key)
      return snapshot?.capabilities
    } finally {
      pendingBackfills.delete(key)
    }
  })()
  pendingBackfills.set(key, lookup)
  return lookup
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if a provider type supports image generation.
 */
export function supportsImageGeneration(providerType: string): providerType is ImageProviderType {
  return Object.hasOwn(PROVIDER_FACTORIES, providerType)
}

export const IMAGE_PROVIDER_OPTIONS = Object.entries(IMAGE_PROVIDER_LABELS).flatMap(
  ([value, label]) => (supportsImageGeneration(value) ? [{ value, label }] : []),
)

// An unknown provider is assumed to need a key and to take no base URL.
function apiKeyMode(providerType: string): FieldMode {
  return supportsImageGeneration(providerType) ? PROVIDER_API_KEY[providerType] : 'required'
}

/** Whether a profile of this provider needs an API key to be usable. */
export function requiresApiKey(providerType: string): boolean {
  return apiKeyMode(providerType) === 'required'
}

/** Whether a profile of this provider has an API key field at all. */
export function takesApiKey(providerType: string): boolean {
  return apiKeyMode(providerType) !== 'none'
}

/** Whether a profile of this provider needs, may take, or has no base URL. */
export function baseUrlMode(providerType: string): FieldMode {
  return supportsImageGeneration(providerType) ? PROVIDER_BASE_URL[providerType] : 'none'
}

/**
 * The API key and base URL a provider uses. The form keeps a value typed for another provider, so
 * a field this one has no input for is dropped rather than sent.
 */
export function connectionFor(
  providerType: string,
  apiKey: string,
  baseUrl: string | undefined,
): { apiKey: string; baseUrl: string | undefined } {
  return {
    apiKey: takesApiKey(providerType) ? apiKey : '',
    baseUrl: baseUrlMode(providerType) === 'none' ? undefined : baseUrl,
  }
}

/**
 * Whether edits through this profile and model can carry a reference image. A model the list
 * does not know passes: only an explicit `supportsImg2Img: false` rules out.
 */
export async function supportsReferenceImages(profileId: string, model: string): Promise<boolean> {
  const profile = settings.getImageProfile(profileId)
  if (!profile || referenceLimit(profile.providerType, profile.providerOptions) === 0) return false
  const capabilities = await modelCapabilities(profile, model)
  return capabilities?.supportsImg2Img !== false
}

/** Adapters take raw base64; a reference can arrive as a data URL or a remote URL. */
export async function toRawBase64(image: string, signal?: AbortSignal): Promise<string> {
  if (/^https?:\/\//i.test(image)) {
    return fetchPublicImageBase64(image, { signal, serviceId: 'image-reference' })
  }
  return image.replace(/^data:[^,]*;base64,/, '')
}

/**
 * Generate an image using an Image Profile.
 * Drop-in replacement for the old sdk/generate.ts generateImage().
 */
export async function generateImage(options: {
  profileId: string
  model: string
  prompt: string
  /** A settings value: an `ImageSpec`, or a `WIDTHxHEIGHT` string from an older build. */
  size?: ImageSpec | string
  referenceImages?: string[]
  signal?: AbortSignal
}): Promise<ImageGenerateResult> {
  const { profileId, model, prompt, size, referenceImages, signal } = options
  const spec = parseImageSpec(size)

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
    size: describeImageSpec(spec),
  })

  const config: ImageProviderConfig = {
    ...connectionFor(profile.providerType, profile.apiKey, profile.baseUrl),
    providerOptions: profile.providerOptions,
    timeoutMs: settings.apiSettings.llmTimeoutMs,
  }

  const provider = PROVIDER_FACTORIES[profile.providerType](config)

  // The model's sizes and reference limit, from the source its provider declares.
  const capabilities = await modelCapabilities(profile, model)

  // A reference that cannot be fetched is dropped; the scene is still worth drawing without it.
  const providerLimit = referenceLimit(profile.providerType, profile.providerOptions)
  const limit = Math.min(capabilities?.maxReferenceImages ?? Infinity, providerLimit)
  const cleanRefs =
    referenceImages && providerLimit > 0
      ? (
          await Promise.allSettled(
            referenceImages.slice(0, limit).map((img) => toRawBase64(img, signal)),
          )
        ).flatMap((result) => {
          if (result.status === 'fulfilled') return [result.value]
          log('Dropped a reference image', { error: result.reason })
          return []
        })
      : undefined

  if (capabilities?.requiresReferenceImage && !cleanRefs?.length) {
    throw new Error(`${model} needs a reference image, and none could be sent`)
  }

  return provider.generate({
    model,
    prompt,
    spec,
    modelInfo: capabilities,
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

  const connection = connectionFor(profile.providerType, profile.apiKey, profile.baseUrl)
  const cacheKey = getCacheKey(profile.providerType, connection.apiKey, connection.baseUrl)
  const cached = modelCaches.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.models
  }

  try {
    const config: ImageProviderConfig = {
      ...connection,
      timeoutMs: settings.apiSettings.llmTimeoutMs,
    }
    const provider = PROVIDER_FACTORIES[profile.providerType](config)
    const models = await provider.listModels(connection.apiKey)
    modelCaches.set(cacheKey, { models, timestamp: Date.now() })
    return models
  } catch (error) {
    log('Error listing models', { providerType: profile.providerType, error })
    return []
  }
}

/**
 * List image models by provider type directly (without needing a profile).
 * Used during profile creation to preview available models. A failed fetch rethrows so the
 * form can show it.
 */
export async function listImageModelsByProvider(
  providerType: ImageProviderType,
  apiKey: string,
  forceReload: boolean,
  baseUrl?: string,
): Promise<ImageModelInfo[]> {
  const connection = connectionFor(providerType, apiKey ?? '', baseUrl)
  const cacheKey = getCacheKey(providerType, connection.apiKey, connection.baseUrl)
  if (!forceReload) {
    const cached = modelCaches.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.models
    }
  }

  try {
    const config: ImageProviderConfig = {
      ...connection,
      timeoutMs: settings.apiSettings.llmTimeoutMs,
    }
    const provider = PROVIDER_FACTORIES[providerType](config)
    const models = await provider.listModels(connection.apiKey)
    modelCaches.set(cacheKey, { models, timestamp: Date.now() })
    return models
  } catch (error) {
    log('Error listing models by provider', { providerType, error })
    throw error
  }
}

/**
 * One model's capabilities: the provider's own per-model lookup when it has one, otherwise
 * the model's entry in its list. A failed request rethrows; `undefined` means an unknown model.
 */
export async function lookupModelCapabilities(
  providerType: ImageProviderType,
  apiKey: string,
  model: string,
  baseUrl?: string,
): Promise<ImageModelCapabilities | undefined> {
  const provider = PROVIDER_FACTORIES[providerType]({
    ...connectionFor(providerType, apiKey, baseUrl),
    timeoutMs: settings.apiSettings.llmTimeoutMs,
  })
  if (provider.getModelCapabilities) return provider.getModelCapabilities(model)
  const models = await listImageModelsByProvider(providerType, apiKey, false, baseUrl)
  return models.find((m) => m.id === model)
}

/**
 * Get sampler/scheduler info for a ComfyUI or A1111 provider.
 */
export async function getProviderSamplerInfo(
  baseUrl?: string,
  providerType: Extract<ImageProviderType, 'comfyui' | 'a1111'> = 'comfyui',
): Promise<{ samplers: string[]; schedulers: string[] }> {
  try {
    const config: ImageProviderConfig = {
      apiKey: '',
      baseUrl,
      timeoutMs: settings.apiSettings.llmTimeoutMs,
    }
    const provider =
      providerType === 'a1111' ? createA1111Provider(config) : createComfyProvider(config)
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
    const config: ImageProviderConfig = {
      apiKey: '',
      baseUrl,
      timeoutMs: settings.apiSettings.llmTimeoutMs,
    }
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
