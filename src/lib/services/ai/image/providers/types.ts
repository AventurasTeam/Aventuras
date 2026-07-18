/**
 * Image Provider Interface & Types
 *
 * Defines the contract for standalone image generation providers.
 * Each provider makes direct HTTP calls instead of going through the Vercel AI SDK.
 */

import type { ImageProviderType } from '$lib/types'
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
    { inputs: Record<string, unknown>; class_type: string; _meta?: { title?: string } }
  >
  /** Dot-path to the positive CLIPTextEncode text input, e.g. "57:27.inputs.text" */
  positivePromptPath: string
  /** Dot-path to the seed input on the KSampler node, e.g. "57:3.inputs.seed" */
  seedPath: string
  /** Node ID of the SaveImage output node, e.g. "9" */
  outputNodeId: string
  /** Dot-path to the negative CLIPTextEncode text input, if detected — null otherwise. */
  negativePromptPath: string | null
}

export interface ImageGenerateOptions {
  model: string
  prompt: string
  size: string
  referenceImages?: string[] // raw base64 (no data: prefix)
  signal?: AbortSignal
  providerOptions?: Record<string, unknown>
}

export interface ImageGenerateResult {
  base64: string
  revisedPrompt?: string
}

export interface ImageModelInfo {
  id: string
  name: string
  description?: string
  supportsSizes: string[]
  supportsImg2Img: boolean
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
  listModels(apiKey?: string): Promise<ImageModelInfo[]>
  // ComfyUI specific
  getSamplerInfo?(): Promise<ComfySamplerInfo>
  listLoras?(): Promise<string[]>
}

export interface ImageProviderConfig {
  apiKey: string
  baseUrl?: string
  providerOptions?: Record<string, unknown>
  timeoutMs?: number
}
