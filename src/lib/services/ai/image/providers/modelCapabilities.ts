import type { ImageCapabilityOverride, ImageModelCapabilities } from '#lib/types/index.ts'
import type { ImageModelInfo } from './types'

/** The generation-relevant fields, copied so nothing is shared with the model list cache. */
export function pickCapabilities(info: ImageModelCapabilities): ImageModelCapabilities {
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

/** The listed model with this id, else the one the provider also serves under it as an alias. */
export function findListedModel(models: ImageModelInfo[], id: string): ImageModelInfo | undefined {
  return models.find((m) => m.id === id) ?? models.find((m) => m.aliases?.includes(id))
}

/** The listed model's own id for `id`, which may be one of its aliases; any other id is returned as it is. */
export function canonicalModelId(id: string, models: ImageModelInfo[]): string {
  return findListedModel(models, id)?.id ?? id
}
