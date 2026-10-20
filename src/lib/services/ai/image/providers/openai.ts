/**
 * OpenAI Image Provider
 *
 * Generates through `@ai-sdk/openai`. Models are fetched live from {baseUrl}/models and
 * filtered by image-capable prefixes; a failed fetch throws.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { specToPixels, formatImageSize } from '#lib/utils/image.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// Prefixes used to identify image-capable models in the /v1/models response
const IMAGE_MODEL_PREFIXES = ['gpt-image-', 'chatgpt-image-']

export function createOpenAIProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl?.trim().replace(/\/$/, '') || DEFAULT_BASE_URL
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('openai-image'),
  })

  return {
    id: 'openai',
    name: 'OpenAI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options

      return generateSdkImage({
        model: openai.image(model),
        prompt,
        referenceImages,
        size: formatImageSize(specToPixels(spec)),
        signal,
      })
    },

    async listModels(apiKey: string): Promise<ImageModelInfo[]> {
      return fetchOpenAIImageModels(baseUrl, apiKey)
    },
  }
}

async function fetchOpenAIImageModels(baseUrl: string, apiKey: string): Promise<ImageModelInfo[]> {
  if (!apiKey) return []

  const response = await imageGetFetch(
    `${baseUrl}/models`,
    { Authorization: `Bearer ${apiKey}` },
    { serviceId: 'openai-image-models' },
  )
  const data = await response.json()
  const entries: { id?: string }[] = Array.isArray(data?.data) ? data.data : []

  return entries
    .filter((m) => m.id && IMAGE_MODEL_PREFIXES.some((prefix) => m.id!.startsWith(prefix)))
    .map((m) => ({ id: m.id!, name: m.id!, supportsImg2Img: true }))
}
