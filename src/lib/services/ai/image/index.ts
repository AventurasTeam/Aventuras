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
  listImageModelsByProvider,
  getProviderSamplerInfo,
  listLoras,
  requiresApiKey,
  type ImageModelInfo,
} from './providers/registry'

// Image generation utilities
export {
  isImageGenerationEnabled,
  hasRequiredCredentials,
  type ImageProfileSlot,
  getProviderDisplayName,
  retryImageGeneration,
  generatePortrait,
  runImageGeneration,
} from './imageUtils'

// Style template resolution
export { resolveStylePrompt, resolveStylePromptForPack } from './stylePrompt'

// Constants
export { DEFAULT_FALLBACK_STYLE_PROMPT } from './constants'
// Provider types
export { ComfyMode } from './providers/comfy'
