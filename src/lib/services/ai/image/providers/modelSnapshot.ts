import type {
  ImageModelCapabilities,
  ImageModelSnapshot,
  ImageProfile,
  ImageProviderType,
} from '#lib/types/index.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import type { ImageModelInfo } from './types'

export const IMAGE_MODEL_SNAPSHOT_VERSION = 1

function pickCapabilities(info?: ImageModelInfo): ImageModelCapabilities {
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
export function snapshotModel(model: string, info?: ImageModelInfo): ImageModelSnapshot {
  return {
    model,
    version: IMAGE_MODEL_SNAPSHOT_VERSION,
    capturedAt: Date.now(),
    capabilities: pickCapabilities(info),
  }
}

/**
 * The snapshot a profile should save. A list still loading may belong to the previous provider,
 * so only a settled one is read; otherwise the stored snapshot survives while the provider and
 * base URL are unchanged.
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
  if (settled && models.length > 0) {
    return snapshotModel(
      model,
      models.find((m) => m.id === model),
    )
  }
  const sameEndpoint =
    stored?.providerType === providerType &&
    normalizeBaseUrl(stored.baseUrl) === normalizeBaseUrl(baseUrl)
  return sameEndpoint ? stored.modelSnapshot : undefined
}
