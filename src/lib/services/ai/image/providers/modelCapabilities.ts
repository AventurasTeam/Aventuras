import type {
  ImageCapabilityOverride,
  ImageModelCapabilities,
  ImageModelConnection,
  ImageModelSnapshot,
  ImageProfile,
} from '#lib/types/index.ts'
import { sameEndpoint } from './connection'
import type { ImageModelInfo } from './types'

export const IMAGE_MODEL_SNAPSHOT_VERSION = 1

export function pickCapabilities(info?: ImageModelCapabilities): ImageModelCapabilities {
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

/** The override fields that replace something the provider published for the model. */
export function overriddenFields(
  override: ImageCapabilityOverride | undefined,
  published: ImageModelCapabilities | undefined,
): Array<'sizes' | 'references'> {
  const fields: Array<'sizes' | 'references'> = []
  if (override?.sizes?.length && published?.supportedResolutions?.length) fields.push('sizes')
  if (override?.references !== undefined && published?.supportsImg2Img !== undefined) {
    fields.push('references')
  }
  return fields
}

export interface OverrideConflict {
  field: 'references'
  message: string
}

/** Where an override contradicts what the provider published in a way that may fail generation. */
export function overrideConflicts(
  override: ImageCapabilityOverride | undefined,
  published: ImageModelCapabilities | undefined,
): OverrideConflict[] {
  const conflicts: OverrideConflict[] = []
  if (override?.references === false && published?.requiresReferenceImage) {
    conflicts.push({
      field: 'references',
      message: 'The provider says this model needs a reference image, so generation may fail.',
    })
  }
  return conflicts
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

/** The profile's saved snapshot, when it is for this model at this endpoint. */
export function storedSnapshotFor(
  stored: ImageProfile | undefined,
  connection: ImageModelConnection,
  model: string,
): ImageModelSnapshot | undefined {
  return stored && sameEndpoint(stored, connection) && stored.modelSnapshot?.model === model
    ? stored.modelSnapshot
    : undefined
}

/**
 * The snapshot a profile should save. A list loaded for other inputs may belong to the previous
 * provider, so only a settled one is read; otherwise the stored snapshot survives while the
 * provider, base URL and model are unchanged. A model a settled list lacks may still be served
 * (an alias), so it is left to the generation-time lookup rather than captured as empty.
 */
export function chooseModelSnapshot(args: {
  model: string
  connection: ImageModelConnection
  models: ImageModelInfo[]
  settled: boolean
  stored?: ImageProfile
}): ImageModelSnapshot | undefined {
  const { model, connection, models, settled, stored } = args
  if (!model) return undefined
  const keep = storedSnapshotFor(stored, connection, model)

  const listed = settled ? models.find((m) => m.id === model) : undefined
  if (!listed) return keep

  const captured = snapshotModel(model, listed)
  return keep && sameSnapshot(keep, captured) ? keep : captured
}
