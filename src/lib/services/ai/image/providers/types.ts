/**
 * Image Provider Interface & Types
 *
 * Defines the contract for standalone image generation providers.
 * Each provider makes direct HTTP calls instead of going through the Vercel AI SDK.
 */

import type { ImageModelCapabilities, ImageProviderType } from '#lib/types/index.ts'
import type { ImageSpec } from '#lib/utils/image.ts'
import type { Json } from './comfyImage'
// Provider specific types
export type ComfySamplerInfo = {
  samplers: string[]
  schedulers: string[]
}

/** A user-uploaded ComfyUI API-format workflow with auto-detected field paths. */
export interface ComfyCustomWorkflow {
  /** The raw API-format workflow JSON (node IDs as keys). */
  workflow: Record<
    string,
    {
      inputs: Record<string, Json>
      class_type: string
      _meta?: { title?: string }
    }
  >
  /** Dot-path to the positive CLIPTextEncode text input, e.g. "57:27.inputs.text" */
  positivePromptPath: string
  /** Dot-path to the seed input on the KSampler node, e.g. "57:3.inputs.seed" */
  seedPath: string
  /** Node ID of the SaveImage output node, e.g. "9" */
  outputNodeId: string
  /** Dot-path to the negative CLIPTextEncode text input, if detected — null otherwise. */
  negativePromptPath: string | null
  /** `LoadImage` image inputs that take reference images; absent means the probe's suggestion. */
  referenceInputPaths?: string[]
}

export interface ImageGenerateOptions {
  model: string
  prompt: string
  /** What the user asked for. Each adapter turns it into whatever its backend takes. */
  spec: ImageSpec
  /** The selected model's capabilities, from the profile's snapshot or the provider's table. */
  modelInfo?: ImageModelCapabilities
  referenceImages?: string[] // raw base64 (no data: prefix)
  signal?: AbortSignal
  providerOptions?: Record<string, unknown>
}

export interface ImageGenerateResult {
  base64: string
  revisedPrompt?: string
}

export interface ImageModelInfo extends ImageModelCapabilities {
  id: string
  name: string
  /** Other ids the provider serves this model under. */
  aliases?: string[]
  description?: string
  costPerImage?: number
  costPerTextToken?: number
  costPerImageToken?: number
  inputModalities?: string[]
  outputModalities?: string[]
}

export interface ImageProvider {
  readonly id: ImageProviderType
  readonly name: string
  generate(options: ImageGenerateOptions): Promise<ImageGenerateResult>
  listModels(apiKey?: string, signal?: AbortSignal): Promise<ImageModelInfo[]>
  /**
   * One model's capabilities, for snapshot providers that can describe a model without listing
   * them all: the lookup that backfills a profile's snapshot. Rejects on failure; `undefined`
   * means the provider does not know the model.
   */
  getModelCapabilities?(model: string): Promise<ImageModelCapabilities | undefined>
  // ComfyUI specific
  getSamplerInfo?(signal?: AbortSignal): Promise<ComfySamplerInfo>
  listLoras?(signal?: AbortSignal): Promise<string[]>
}

export interface ImageProviderConfig {
  apiKey: string
  baseUrl?: string
  providerOptions?: Record<string, unknown>
  timeoutMs?: number
}
