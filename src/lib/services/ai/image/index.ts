/**
 * AI Image Module
 *
 * Image generation services using standalone provider registry.
 * - InlineImageService: Inline image generation during narrative
 * - Provider registry: Direct HTTP calls per provider
 * - imageUtils: Helper functions for image generation
 */

// Main inline image service
export { inlineImageService, type InlineImageContext } from './InlineImageService'

// Inline image tracker for streaming
export { InlineImageTracker } from './InlineImageTracker'

// Image analysis service (analyzed/agent mode)
export { ImageAnalysisService, type ImageAnalysisContext } from './ImageAnalysisService'

// Provider registry (replaces modelListing.ts)
export {
  generateImage,
  supportsReferenceImages,
  toRawBase64,
  listImageModels,
  evictReplacedModelList,
  getProviderSamplerInfo,
  listLoras,
  getProviderClipTypes,
  isLocalServer,
  referenceLimit,
  providerNeedsModel,
  referenceBlocker,
  takesCapabilityOverride,
  IMAGE_PROVIDER_LABELS,
  IMAGE_PROVIDER_OPTIONS,
  type ImageModelInfo,
} from './providers/registry'

export { resolveBaseUrl } from './providers/baseUrls'

export {
  baseUrlMode,
  imageConnectionFor,
  modelListKey,
  requiresApiKey,
} from './providers/connection'

export {
  applyCapabilityOverride,
  canonicalModelId,
  findListedModel,
  overriddenFields,
  overrideConflicts,
} from './providers/modelCapabilities'

export {
  LOADED_LIST_LABELS,
  groupLoadFailures,
  sortLoadFailures,
  type LoadFailure,
  type LoadedList,
} from './loadFailures'

// Image generation utilities
export {
  isImageGenerationEnabled,
  hasRequiredCredentials,
  missingCredential,
  warmSlotCapabilities,
  portraitCredentialError,
  type MissingCredential,
  type ImageProfileSlot,
  getProviderDisplayName,
  retryImageGeneration,
  generatePortrait,
  runImageGeneration,
} from './imageUtils'

// Portrait lookups for reference-mode scenes
export {
  PendingPortraits,
  refreshCharacter,
  referencePortraitSources,
  resolveReferenceUrls,
  resolveScenes,
  type PortraitSource,
  type ResolvedScene,
} from './portraitReferences'

// Style template resolution
export { resolveStylePrompt, resolveStylePromptForPack } from './stylePrompt'

// Constants
export { DEFAULT_FALLBACK_STYLE_PROMPT } from './constants'
// Provider types
export {
  ComfyMode,
  detectWorkflowFields,
  isWorkflowComplete,
  listNodes,
  loadImageInputs,
  pickInputs,
  referenceInputsOf,
  suggestReferenceInputs,
  validateApiWorkflow,
  workflowInputs,
  workflowProblems,
  type WorkflowInput,
} from './providers/comfy'
export type { ComfyCustomWorkflow } from './providers/types'
