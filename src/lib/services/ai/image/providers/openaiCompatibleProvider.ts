/**
 * OpenAI Compatible Image Provider
 *
 * Generates through `@ai-sdk/openai-compatible` against a user-supplied base URL (LiteLLM and
 * other proxies). The key is optional, and models are listed unfiltered from {baseUrl}/models.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
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
  return parseModelList(await response.json(), ModelEntry)
}
