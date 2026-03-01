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
  supportsImg2Img(modelId: string): boolean
  // ComfyUI specific
  getSamplerInfo?(): Promise<ComfySamplerInfo>
  listLoras?(): Promise<string[]>
}

export interface ImageProviderConfig {
  apiKey: string
  baseUrl?: string
  providerOptions?: Record<string, unknown>
}
