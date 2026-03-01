/**
 * AI Image Module
 *
 * Image generation services using standalone provider registry.
 * - InlineImageService: Inline image generation during narrative
 * - Provider registry: Direct HTTP calls per provider
 * - imageUtils: Helper functions for image generation
 */

// Main inline image service
export {
  InlineImageGenerationService,
  inlineImageService,
  type InlineImageContext,
} from './InlineImageService'

// Inline image tracker for streaming
export { InlineImageTracker } from './InlineImageTracker'

// Image analysis service (analyzed/agent mode)
export { ImageAnalysisService, type ImageAnalysisContext } from './ImageAnalysisService'

// Provider registry (replaces modelListing.ts)
export {
  generateImage,
  listImageModels,
  listImageModelsByProvider,
  getComfySamplerInfo,
  listLoras,
  clearModelsCache,
  supportsImageGeneration,
  type ImageModelInfo,
} from './providers/registry'

// Image generation utilities
export {
  isImageGenerationEnabled,
  hasRequiredCredentials,
  getProviderDisplayName,
  retryImageGeneration,
  generatePortrait,
} from './imageUtils'

// Constants
export {
  DEFAULT_FALLBACK_STYLE_PROMPT,
  POLLINATIONS_DEFAULT_MODEL_ID,
  POLLINATIONS_REFERENCE_MODEL_ID,
  IMAGE_STUCK_THRESHOLD_MS,
} from './constants'
// Provider types
export { ComfyMode } from './providers/comfy'
