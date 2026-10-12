/**
 * Pollinations Image Provider
 *
 * Generates against gen.pollinations.ai/v1; model discovery uses Pollinations' own catalogue.
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

import { POLLINATIONS_DEFAULT_MODEL_ID, POLLINATIONS_REFERENCE_MODEL_ID } from '../constants'
const DEFAULT_MODEL = POLLINATIONS_DEFAULT_MODEL_ID
const REFERENCE_MODEL = POLLINATIONS_REFERENCE_MODEL_ID
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

      return generateOpenAICompatible({
        baseUrl: GENERATION_BASE_URL,
        apiKey: config.apiKey,
        model: model || DEFAULT_MODEL,
        prompt,
        size: formatImageSize(specToPixels(spec)),
        referenceImages,
        extraFields: { safe: false, nologo: true },
        signal,
        serviceId: 'pollinations-image',
      })
    },

    async listModels(apiKey?: string): Promise<ImageModelInfo[]> {
      try {
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

        const response = await imageGetFetch(MODELS_ENDPOINT, headers)
        if (!response.ok) return getFallbackModels()

        const data = await response.json()
        if (!Array.isArray(data) || data.length === 0) return getFallbackModels()

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
      } catch {
        return getFallbackModels()
      }
    },
  }
}

function getFallbackModels(): ImageModelInfo[] {
  return [
    {
      id: DEFAULT_MODEL,
      name: 'Z Image',
      description: 'Default fast image generation',
      supportsImg2Img: false,
    },
    {
      id: 'flux',
      name: 'Flux',
      description: 'High quality image generation',
      supportsImg2Img: false,
    },
    {
      id: REFERENCE_MODEL,
      name: 'Flux Kontext',
      description: 'In-context editing & generation',
      supportsImg2Img: true,
    },
  ]
}
