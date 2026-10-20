/**
 * OpenAI Compatible Image Provider
 *
 * Generates through `@ai-sdk/openai-compatible` against a user-supplied base URL (LiteLLM and
 * other proxies). The key is optional, and models are listed unfiltered from {baseUrl}/models.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
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

// Spread into the request body, which this provider reads under its camelCase name.
const PROVIDER_OPTIONS_KEY = 'openaiCompatible'

export function createOpenAICompatibleProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '')

  return {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options
      if (!baseUrl) throw new Error('OpenAI-compatible provider requires a custom base URL')

      const provider = createOpenAICompatible({
        name: PROVIDER_OPTIONS_KEY,
        baseURL: baseUrl,
        apiKey: config.apiKey || undefined,
        fetch: createImageSdkFetch('openai-compatible-image'),
      })

      return generateSdkImage({
        model: provider.imageModel(model),
        prompt,
        referenceImages,
        size: formatImageSize(specToPixels(spec)),
        providerOptions: { [PROVIDER_OPTIONS_KEY]: { response_format: 'b64_json' } },
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
}
