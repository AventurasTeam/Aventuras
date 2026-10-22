/**
 * Pollinations Image Provider
 *
 * Generates through the OpenAI Compatible SDK path against gen.pollinations.ai/v1; model discovery
 * uses Pollinations' own catalogue.
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
import { generateOpenAICompatibleImage } from './openaiCompatibleProvider'

const GENERATION_BASE_URL = 'https://gen.pollinations.ai/v1'
const MODELS_ENDPOINT = 'https://gen.pollinations.ai/image/models'

interface PollinationsImageModelResponse {
  name: string
  description?: string
  input_modalities?: string[]
  output_modalities?: string[]
  pricing?: {
    completionImageTokens?: string | number
    promptTextTokens?: string | number
    promptImageTokens?: string | number
  }
}

function parseOptionalNumber(val: string | number | undefined | null): number | undefined {
  if (val === undefined || val === null || val === '') return undefined
  const num = Number(val)
  return isNaN(num) ? undefined : num
}

export function createPollinationsProvider(config: ImageProviderConfig): ImageProvider {
  return {
    id: 'pollinations',
    name: 'Pollinations',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options

      if (!config.apiKey) {
        throw new Error('Pollinations API key is required to bypass Turnstile protection.')
      }

      return generateOpenAICompatibleImage({
        baseUrl: GENERATION_BASE_URL,
        apiKey: config.apiKey,
        serviceId: 'pollinations-image',
        model,
        prompt,
        size: formatImageSize(specToPixels(spec)),
        referenceImages,
        extraFields: { safe: false },
        signal,
      })
    },

    async listModels(apiKey?: string): Promise<ImageModelInfo[]> {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

      const response = await imageGetFetch(MODELS_ENDPOINT, headers)
      const data = await response.json()
      if (!Array.isArray(data)) throw new Error('Pollinations returned an unexpected model list')

      return (data as PollinationsImageModelResponse[])
        .filter((model) => model.output_modalities?.includes('image') ?? false)
        .map((model) => ({
          id: model.name,
          name: model.name,
          description: model.description,
          supportsImg2Img: model.input_modalities?.includes('image') ?? false,
          costPerImage: parseOptionalNumber(model.pricing?.completionImageTokens),
          costPerTextToken: parseOptionalNumber(model.pricing?.promptTextTokens),
          costPerImageToken: parseOptionalNumber(model.pricing?.promptImageTokens),
          inputModalities: model.input_modalities,
          outputModalities: model.output_modalities,
        }))
    },
  }
}
