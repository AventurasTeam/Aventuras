/**
 * OpenAI Compatible Image Provider
 *
 * Generates through `@ai-sdk/openai-compatible` against a user-supplied base URL (LiteLLM and
 * other proxies). The key is optional, and models are listed unfiltered from {baseUrl}/models.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { JSONValue } from '@ai-sdk/provider'
import * as z from 'zod'
import { specToPixels, formatImageSize } from '#lib/utils/image.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { parseModelList } from './parseModelList'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

// Spread into the request body, which this provider reads under its camelCase name.
const PROVIDER_OPTIONS_KEY = 'openaiCompatible'

const ModelEntry = z
  .object({ id: z.string().catch(''), name: z.string().catch('') })
  .refine(({ id, name }) => id || name)
  .transform(({ id, name }): ImageModelInfo => ({
    id: id || name,
    name: name || id,
    supportsImg2Img: true,
  }))

/** Shared with Pollinations and Z.AI, whose endpoints match; `extraFields` join the request body. */
export async function generateOpenAICompatibleImage(options: {
  baseUrl: string
  apiKey?: string
  serviceId: string
  model: string
  prompt: string
  size: `${number}x${number}`
  referenceImages?: string[]
  extraFields?: Record<string, JSONValue>
  signal?: AbortSignal
}): Promise<ImageGenerateResult> {
  const { baseUrl, apiKey, serviceId, model, prompt, size, referenceImages, extraFields, signal } =
    options

  const provider = createOpenAICompatible({
    name: PROVIDER_OPTIONS_KEY,
    baseURL: baseUrl,
    apiKey: apiKey || undefined,
    fetch: createImageSdkFetch(serviceId),
  })

  return generateSdkImage({
    model: provider.imageModel(model),
    prompt,
    referenceImages,
    size,
    providerOptions: { [PROVIDER_OPTIONS_KEY]: { response_format: 'b64_json', ...extraFields } },
    signal,
  })
}

export function createOpenAICompatibleProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '')

  return {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options
      if (!baseUrl) throw new Error('OpenAI-compatible provider requires a custom base URL')

      return generateOpenAICompatibleImage({
        baseUrl,
        apiKey: config.apiKey,
        serviceId: 'openai-compatible-image',
        model,
        prompt,
        size: formatImageSize(specToPixels(spec)),
        referenceImages,
        signal,
      })
    },

    async listModels(apiKey?: string): Promise<ImageModelInfo[]> {
      if (!baseUrl) return []
      return fetchCustomModels(baseUrl, apiKey)
    },
  }
}

async function fetchCustomModels(baseUrl: string, apiKey?: string): Promise<ImageModelInfo[]> {
  const response = await imageGetFetch(
    `${baseUrl}/models`,
    apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    { serviceId: 'openai-compatible-image-models' },
  )
  return parseModelList(await response.json(), ModelEntry)
}
