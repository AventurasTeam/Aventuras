/**
 * Image Provider Registry
 *
 * Central dispatcher for image generation. Resolves ImageProfile → provider,
 * delegates generate/listModels calls. Drop-in replacement for the old
 * sdk/generate.ts generateImage().
 */

import { isAbortError } from '#lib/services/activity/index.ts'
import { settings } from '#lib/stores/settings.svelte.ts'
import type {
  ImageModelCapabilities,
  ImageModelConnection,
  ImageProfile,
  ImageProviderType,
} from '#lib/types/index.ts'
import { parseImageSpec, describeImageSpec, type ImageSpec } from '#lib/utils/image.ts'
import type {
  ComfySamplerInfo,
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { createLogger } from '#lib/log.ts'
import { fetchPublicImageBase64 } from './fetchAdapter'
import { isImageProviderType, modelListKey } from './connection'
import { applyCapabilityOverride, findListedModel } from './modelSnapshot'
import { snapshotCapabilities } from './snapshotBackfill'

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

function createProvider(
  { providerType, apiKey, baseUrl }: ImageModelConnection,
  providerOptions?: ImageProviderConfig['providerOptions'],
): ImageProvider {
  return PROVIDER_FACTORIES[providerType]({
    apiKey,
    baseUrl,
    providerOptions,
    timeoutMs: settings.apiSettings.llmTimeoutMs,
  })
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

/** Whether a profile of this provider type has a capability override: only the type that fronts hosts publishing nothing usable. */
export const takesCapabilityOverride = (providerType: ImageProviderType): boolean =>
  providerType === 'openai-compatible'

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

const CACHE_TTL = 12 * 60 * 60 * 1000
const modelCaches = new Map<string, ModelCache>()

/** Drops the cached list for `previous`'s connection when `next` uses a different one. */
export function evictReplacedModelList(
  previous: ImageModelConnection,
  next: ImageModelConnection,
): void {
  const previousKey = modelListKey(previous)
  if (previousKey !== modelListKey(next)) modelCaches.delete(previousKey)
}

// ============================================================================
// Model Capabilities
// ============================================================================

/** What a profile's model can do: the source its provider declares, then the profile's own override. */
async function modelCapabilities(
  profile: ImageProfile,
  model: string,
): Promise<ImageModelCapabilities | undefined> {
  const provided = await providedCapabilities(profile, model)
  return takesCapabilityOverride(profile.providerType)
    ? applyCapabilityOverride(provided, profile.capabilityOverride)
    : provided
}

async function providedCapabilities(
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
      return snapshotCapabilities(profile, model, lookupCapabilities)
    default: {
      const unreachable: never = source
      return unreachable
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

export const IMAGE_PROVIDER_OPTIONS = Object.entries(IMAGE_PROVIDER_LABELS).flatMap(
  ([value, label]) => (isImageProviderType(value) ? [{ value, label }] : []),
)

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

  log('generateImage', {
    profileId,
    model,
    providerType: profile.providerType,
    hasReferences: !!referenceImages?.length,
    size: describeImageSpec(spec),
  })

  const provider = createProvider(profile, profile.providerOptions)

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
    throw new Error(
      takesCapabilityOverride(profile.providerType) &&
        profile.capabilityOverride?.references === false
        ? `${model} needs a reference image, but this profile's References override is Off`
        : `${model} needs a reference image, and none could be sent`,
    )
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
 * A connection's models. A failed fetch rethrows so the form can show it; an aborted `signal`
 * rejects and caches nothing, even when the adapter answered with a partial list.
 */
export async function listImageModels(
  connection: ImageModelConnection,
  forceReload: boolean,
  signal?: AbortSignal,
): Promise<ImageModelInfo[]> {
  const { providerType } = connection
  const cacheKey = modelListKey(connection)
  if (!forceReload) {
    const cached = modelCaches.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.models
    }
  }

  try {
    const models = await createProvider(connection).listModels(signal)
    signal?.throwIfAborted()
    modelCaches.set(cacheKey, { models, timestamp: Date.now() })
    return models
  } catch (error) {
    if (!isAbortError(error)) log('Error listing models by provider', { providerType, error })
    throw error
  }
}

/**
 * One model's capabilities: its entry in the connection's cached list (by id or alias), otherwise
 * the provider's own lookup for a model the list omits. A failed request rethrows; `undefined`
 * means an unknown model.
 */
async function lookupCapabilities(
  connection: ImageModelConnection,
  model: string,
): Promise<ImageModelCapabilities | undefined> {
  const models = await listImageModels(connection, false)
  const found =
    findListedModel(models, model) ??
    (await createProvider(connection).getModelCapabilities?.(model, models))
  // An empty list proves nothing about one model.
  if (!found && !models.length) throw new Error(`${connection.providerType} listed no models`)
  return found
}

/** Sampler and scheduler names for a ComfyUI or A1111 server. Rejects when the server cannot be read. */
export async function getProviderSamplerInfo(
  baseUrl?: string,
  providerType: Extract<ImageProviderType, 'comfyui' | 'a1111'> = 'comfyui',
  signal?: AbortSignal,
): Promise<ComfySamplerInfo> {
  const config: ImageProviderConfig = {
    apiKey: '',
    baseUrl,
    timeoutMs: settings.apiSettings.llmTimeoutMs,
  }
  const provider =
    providerType === 'a1111' ? createA1111Provider(config) : createComfyProvider(config)
  return (await provider.getSamplerInfo?.(signal)) ?? { samplers: [], schedulers: [] }
}

/** LoRA names for a ComfyUI server. Rejects when the server cannot be read. */
export async function listLoras(baseUrl?: string, signal?: AbortSignal): Promise<string[]> {
  const provider = createComfyProvider({
    apiKey: '',
    baseUrl,
    timeoutMs: settings.apiSettings.llmTimeoutMs,
  })
  return (await provider.listLoras?.(signal)) ?? []
}

/** CLIP types a ComfyUI server accepts. Rejects when the server cannot be read. */
export async function getProviderClipTypes(
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const provider = createComfyProvider({
    apiKey: '',
    baseUrl,
    timeoutMs: settings.apiSettings.llmTimeoutMs,
  })
  return (await provider.listClipTypes?.(signal)) ?? []
}

// Re-export types for convenience
export type { ImageModelInfo, ImageGenerateResult } from './types'
