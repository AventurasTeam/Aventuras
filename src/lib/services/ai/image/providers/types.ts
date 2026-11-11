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
  /** Why `schedulers` is empty when the server cannot list them, as opposed to having none. */
  schedulersUnavailable?: string
}

/** A user-uploaded ComfyUI API-format workflow and the inputs the app writes into. */
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
  /** Dot-paths of the text inputs that each receive the scene prompt, e.g. "57:27.inputs.text". */
  positivePromptPaths: string[]
  /** Dot-path to the seed input, e.g. "57:3.inputs.noise_seed"; null keeps the workflow's own seed. */
  seedPath: string | null
  /** Node ID of the output node, e.g. "9"; null until one is chosen. */
  outputNodeId: string | null
  /** Dot-paths of the text inputs that each receive the negative prompt; empty when the workflow has none. */
  negativePromptPaths: string[]
  /** `LoadImage` image inputs that take reference images; absent means the probe's suggestion. */
  referenceInputPaths?: string[]
}

export interface ImageGenerateOptions {
  model: string
  prompt: string
  /** What the user asked for. Each adapter turns it into whatever its backend takes. */
  spec: ImageSpec
  /** The selected model's capabilities, from the provider's model list or its table. */
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
  inputModalities?: string[]
  outputModalities?: string[]
}

export interface ImageProvider {
  readonly id: ImageProviderType
  readonly name: string
  generate(options: ImageGenerateOptions): Promise<ImageGenerateResult>
  listModels(signal?: AbortSignal): Promise<ImageModelInfo[]>
  /**
   * One model's capabilities, for a provider that can describe a model its `listed` models lack.
   * Rejects on failure; `undefined` means the provider does not know the model.
   */
  getModelCapabilities?(
    model: string,
    listed: ImageModelInfo[],
    signal?: AbortSignal,
  ): Promise<ImageModelCapabilities | undefined>
  // ComfyUI specific
  getSamplerInfo?(signal?: AbortSignal): Promise<ComfySamplerInfo>
  listLoras?(signal?: AbortSignal): Promise<string[]>
  listClipTypes?(signal?: AbortSignal): Promise<string[]>
}

export interface ImageProviderConfig {
  apiKey: string
  baseUrl?: string
  providerOptions?: Record<string, unknown>
  timeoutMs?: number
}
