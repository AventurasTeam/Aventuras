import type {
  ImageCapabilityOverride,
  ImageModelCapabilities,
  ImageModelSnapshot,
  ImageProfile,
  ImageProviderType,
} from '#lib/types/index.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import type { ImageModelInfo } from './types'

export const IMAGE_MODEL_SNAPSHOT_VERSION = 1

function pickCapabilities(info?: ImageModelCapabilities): ImageModelCapabilities {
  if (!info) return {}
  const { referenceConstraints, supportedResolutions, supportedAspectRatios } = info
  return {
    supportsImg2Img: info.supportsImg2Img,
    maxReferenceImages: info.maxReferenceImages,
    requiresReferenceImage: info.requiresReferenceImage,
    referenceConstraints: referenceConstraints && {
      ...referenceConstraints,
      mimeTypes: referenceConstraints.mimeTypes?.slice(),
    },
    supportedResolutions: supportedResolutions?.slice(),
    supportedAspectRatios: supportedAspectRatios?.slice(),
  }
}

/** The model's generation-relevant fields; a model the list does not know snapshots as `{}`. */
export function snapshotModel(model: string, info?: ImageModelCapabilities): ImageModelSnapshot {
  return {
    model,
    version: IMAGE_MODEL_SNAPSHOT_VERSION,
    capturedAt: Date.now(),
    capabilities: pickCapabilities(info),
  }
}

/** The capabilities with each field the profile's override sets replaced; a blank field defers to the provider. */
export function applyCapabilityOverride(
  capabilities: ImageModelCapabilities | undefined,
  override: ImageCapabilityOverride | undefined,
): ImageModelCapabilities | undefined {
  if (!override) return capabilities
  const { minPixels, sizes, references } = override
  const merged: ImageModelCapabilities = { ...capabilities }
  if (minPixels) merged.minPixels = minPixels
  if (sizes?.length) merged.supportedResolutions = sizes
  if (references === false) {
    merged.supportsImg2Img = false
    merged.maxReferenceImages = 0
  } else if (references === true) {
    merged.supportsImg2Img = true
    if (merged.maxReferenceImages === 0) delete merged.maxReferenceImages
  }
  return merged
}

/**
 * Whether two snapshots say the same thing, whatever time each was captured. A key set to
 * `undefined` counts as missing: a stored snapshot has lost those keys to JSON.
 */
export function sameSnapshot(a: ImageModelSnapshot, b: ImageModelSnapshot): boolean {
  return (
    a.model === b.model &&
    a.version === b.version &&
    JSON.stringify(a.capabilities) === JSON.stringify(b.capabilities)
  )
}

/** The listed model with this id, else the one the provider also serves under it as an alias. */
export function findListedModel(models: ImageModelInfo[], id: string): ImageModelInfo | undefined {
  return models.find((m) => m.id === id) ?? models.find((m) => m.aliases?.includes(id))
}

/** The listed model's own id for `id`, which may be one of its aliases; any other id is returned as it is. */
export function canonicalModelId(id: string, models: ImageModelInfo[]): string {
  return findListedModel(models, id)?.id ?? id
}

/** Identifies the inputs a model list was loaded for. */
export function modelListKey(
  providerType: ImageProviderType,
  apiKey: string,
  baseUrl?: string,
): string {
  return JSON.stringify([providerType, apiKey, normalizeBaseUrl(baseUrl)])
}

/**
 * The snapshot a profile should save. A list loaded for other inputs may belong to the previous
 * provider, so only a settled one is read; otherwise the stored snapshot survives while the
 * provider, base URL and model are unchanged. A model a settled list lacks may still be served
 * (an alias), so it is left to the generation-time lookup rather than captured as empty.
 */
export function chooseModelSnapshot(args: {
  model: string
  providerType: ImageProviderType
  baseUrl?: string
  models: ImageModelInfo[]
  settled: boolean
  stored?: ImageProfile
}): ImageModelSnapshot | undefined {
  const { model, providerType, baseUrl, models, settled, stored } = args
  if (!model) return undefined
  const sameEndpoint =
    stored?.providerType === providerType &&
    normalizeBaseUrl(stored.baseUrl) === normalizeBaseUrl(baseUrl)
  const keep =
    sameEndpoint && stored.modelSnapshot?.model === model ? stored.modelSnapshot : undefined

  const listed = settled ? models.find((m) => m.id === model) : undefined
  if (!listed) return keep

  const captured = snapshotModel(model, listed)
  return keep && sameSnapshot(keep, captured) ? keep : captured
}
