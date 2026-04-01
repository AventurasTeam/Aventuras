/**
 * Pollinations Image Provider
 *
 * GET-based API at image.pollinations.ai.
 * - txt2img: GET image.pollinations.ai/prompt/{prompt}?params
 * - img2img: ?image= param for kontext model
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'

import {
  POLLINATIONS_DEFAULT_MODEL_ID,
  POLLINATIONS_REFERENCE_MODEL_ID,
  POLLINATIONS_SUPPORTED_SIZES,
} from '../constants'
const DEFAULT_MODEL = POLLINATIONS_DEFAULT_MODEL_ID
const REFERENCE_MODEL = POLLINATIONS_REFERENCE_MODEL_ID
const MODELS_ENDPOINT = 'https://gen.pollinations.ai/image/models'

interface PollinationsImageModelResponse {
  name: string
  description?: string
  input_modalities?: string[]
  output_modalities?: string[]
  paid_only?: boolean
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
      const { model, prompt, size, referenceImages, signal } = options
      const [width, height] = size.split('x').map(Number)

      if (!config.apiKey) {
        throw new Error('Pollinations API key is required to bypass Turnstile protection.')
      }

      const params = new URLSearchParams({
        model: model || DEFAULT_MODEL,
        width: String(width || 1024),
        height: String(height || 1024),
        nologo: 'true',
        safe: 'false',
      })

      // img2img via ?image= param for kontext model
      if (referenceImages?.length) {
        params.set('image', `data:image/png;base64,${referenceImages[0]}`)
      }

      const encodedPrompt = encodeURIComponent(prompt)
      const url = `https://gen.pollinations.ai/image/${encodedPrompt}?${params}`

      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
      }

      const response = await imageGetFetch(url, headers, {
        signal,
        serviceId: 'pollinations-image',
      })

      // Response is the image directly
      const blob = await response.blob()
      const buffer = await blob.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binary)

      return { base64 }
    },

    async listModels(apiKey?: string): Promise<ImageModelInfo[]> {
      try {
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

        const response = await fetch(MODELS_ENDPOINT, { headers })
        if (!response.ok) return getFallbackModels()

        const data = await response.json()
        if (!Array.isArray(data) || data.length === 0) return getFallbackModels()

        return (data as PollinationsImageModelResponse[])
          .filter(
            (model) => (model.output_modalities?.includes('image') ?? false) && !model.paid_only,
          )
          .map((model) => ({
            id: model.name,
            name: model.name,
            description: model.description,
            supportsSizes: POLLINATIONS_SUPPORTED_SIZES,
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
      supportsSizes: POLLINATIONS_SUPPORTED_SIZES,
      supportsImg2Img: false,
    },
    {
      id: 'flux',
      name: 'Flux',
      description: 'High quality image generation',
      supportsSizes: POLLINATIONS_SUPPORTED_SIZES,
      supportsImg2Img: false,
    },
    {
      id: REFERENCE_MODEL,
      name: 'Flux Kontext',
      description: 'In-context editing & generation',
      supportsSizes: POLLINATIONS_SUPPORTED_SIZES,
      supportsImg2Img: true,
    },
  ]
}
