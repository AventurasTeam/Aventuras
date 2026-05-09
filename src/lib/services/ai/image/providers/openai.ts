/**
 * OpenAI Image Provider
 *
 * Direct HTTP calls to OpenAI-compatible image APIs.
 * - txt2img: POST /images/generations (JSON)
 * - img2img: POST /images/edits (FormData)
 *
 * Models are fetched live from {baseUrl}/models and filtered by image-capable prefixes.
 * Known models are enriched with size/img2img metadata; unknown future models get defaults.
 * Falls back to a hardcoded list if the API call fails.
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageFetch, imageGetFetch } from './fetchAdapter'

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
      const { model, prompt, size, referenceImages, signal } = options

      if (referenceImages?.length) {
        return generateWithEdits(
          baseUrl,
          config.apiKey,
          model,
          prompt,
          size,
          referenceImages,
          signal,
        )
      }

      const body = {
        model,
        prompt,
        size,
        n: 1,
        response_format: 'b64_json',
      }

      const response = await imageFetch({
        url: `${baseUrl}/images/generations`,
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
        serviceId: 'openai-image',
      })

      const data = await response.json()
      const imageData = data?.data?.[0]
      if (!imageData?.b64_json) throw new Error('No image data in OpenAI response')

      return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
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
          supportsSizes: ['512x512', '1024x1024'],
          supportsImg2Img: true,
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
        supportsSizes: [],
        supportsImg2Img: false,
      }))
  } catch {
    return []
  }
}

async function generateWithEdits(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  referenceImages: string[],
  signal?: AbortSignal,
): Promise<ImageGenerateResult> {
  const formData = new FormData()
  formData.append('model', model)
  formData.append('prompt', prompt)
  formData.append('size', size)
  formData.append('n', '1')
  formData.append('response_format', 'b64_json')

  // Convert base64 to blob for the image field
  const imageBytes = Uint8Array.from(atob(referenceImages[0]), (c) => c.charCodeAt(0))
  const imageBlob = new Blob([imageBytes], { type: 'image/png' })
  formData.append('image', imageBlob, 'reference.png')

  const response = await imageFetch({
    url: `${baseUrl}/images/edits`,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      // Don't set Content-Type - let FormData set the boundary
    },
    body: formData,
    signal,
    serviceId: 'openai-image-edit',
  })

  const data = await response.json()
  const imageData = data?.data?.[0]
  if (!imageData?.b64_json) throw new Error('No image data in OpenAI edits response')

  return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
}
