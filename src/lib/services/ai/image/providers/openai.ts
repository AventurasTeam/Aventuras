/**
 * OpenAI Image Provider
 *
 * Models are fetched live from {baseUrl}/models and filtered by image-capable prefixes;
 * a failed fetch yields an empty list.
 */

import { specToPixels, formatImageSize } from '#lib/utils/image.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { generateOpenAICompatible } from './openaiCompatible'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// Prefixes used to identify image-capable models in the /v1/models response
const IMAGE_MODEL_PREFIXES = ['dall-e-', 'gpt-image-']

export function createOpenAIProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl?.trim().replace(/\/$/, '') || DEFAULT_BASE_URL
  const isCustomEndpoint = !!config.baseUrl?.trim()

  return {
    id: 'openai',
    name: 'OpenAI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options

      return generateOpenAICompatible({
        baseUrl,
        apiKey: config.apiKey,
        model,
        prompt,
        size: formatImageSize(specToPixels(spec)),
        referenceImages,
        signal,
        serviceId: 'openai-image',
      })
    },

    async listModels(apiKey: string): Promise<ImageModelInfo[]> {
      if (isCustomEndpoint) {
        return fetchCustomModels(baseUrl, apiKey)
      }
      return fetchOpenAIImageModels(baseUrl, apiKey)
    },
  }
}

async function fetchOpenAIImageModels(baseUrl: string, apiKey: string): Promise<ImageModelInfo[]> {
  try {
    const response = await imageGetFetch(
      `${baseUrl}/models`,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      { serviceId: 'openai-image-models' },
    )
    const data = await response.json()
    const entries: { id?: string }[] = Array.isArray(data?.data) ? data.data : []

    return entries
      .filter((m) => m.id && IMAGE_MODEL_PREFIXES.some((prefix) => m.id!.startsWith(prefix)))
      .map((m) => {
        const id = m.id!
        return {
          id,
          name: id,
          supportsImg2Img: true,
          // dall-e edits take a single image.
          maxReferenceImages: id.startsWith('dall-e-') ? 1 : undefined,
        }
      })
  } catch {
    return []
  }
}

async function fetchCustomModels(baseUrl: string, apiKey: string): Promise<ImageModelInfo[]> {
  try {
    const response = await imageGetFetch(
      `${baseUrl}/models`,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      { serviceId: 'openai-image-models' },
    )
    const data = await response.json()
    const entries: { id?: string; name?: string }[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : []

    return entries
      .filter((m) => m.id || m.name)
      .map((m) => ({
        id: m.id || m.name || '',
        name: m.name || m.id || '',
        supportsImg2Img: false,
      }))
  } catch {
    return []
  }
}
