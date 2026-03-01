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

const DEFAULT_MODEL = 'zimage'
const REFERENCE_MODEL = 'kontext'
const MODELS_ENDPOINT = 'https://gen.pollinations.ai/image/models'

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

        return data.map(
          (model: {
            name: string
            description?: string
            input_modalities?: string[]
            output_modalities?: string[]
            pricing?: {
              completionImageTokens?: number
              promptTextTokens?: number
              promptImageTokens?: number
            }
          }) => ({
            id: model.name,
            name: model.name,
            description: model.description,
            supportsSizes: ['512x512', '1024x1024', '2048x2048'],
            supportsImg2Img: model.input_modalities?.includes('image') ?? false,
            costPerImage: model.pricing?.completionImageTokens,
            costPerTextToken: model.pricing?.promptTextTokens,
            costPerImageToken: model.pricing?.promptImageTokens,
            inputModalities: model.input_modalities,
            outputModalities: model.output_modalities,
          }),
        )
      } catch {
        return getFallbackModels()
      }
    },

    supportsImg2Img(modelId: string): boolean {
      return modelId === REFERENCE_MODEL || modelId.includes('kontext')
    },
  }
}

function getFallbackModels(): ImageModelInfo[] {
  return [
    {
      id: DEFAULT_MODEL,
      name: 'Z Image',
      description: 'Default fast image generation',
      supportsSizes: ['512x512', '1024x1024', '2048x2048'],
      supportsImg2Img: false,
    },
    {
      id: 'flux',
      name: 'Flux',
      description: 'High quality image generation',
      supportsSizes: ['512x512', '1024x1024', '2048x2048'],
      supportsImg2Img: false,
    },
    {
      id: REFERENCE_MODEL,
      name: 'Flux Kontext',
      description: 'In-context editing & generation',
      supportsSizes: ['512x512', '1024x1024', '2048x2048'],
      supportsImg2Img: true,
    },
  ]
}
