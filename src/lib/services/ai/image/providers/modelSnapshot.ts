import type {
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
  const listed = settled ? models.find((m) => m.id === model) : undefined
  if (listed) return snapshotModel(model, listed)

  const sameEndpoint =
    stored?.providerType === providerType &&
    normalizeBaseUrl(stored.baseUrl) === normalizeBaseUrl(baseUrl)
  return sameEndpoint && stored.modelSnapshot?.model === model ? stored.modelSnapshot : undefined
}
