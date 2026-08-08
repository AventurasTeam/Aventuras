/**
 * Google Image Provider
 *
 * Uses the Vercel AI SDK (@ai-sdk/google) for all image generation.
 * Supports both Imagen models (:predict) and Gemini image models
 * (gemini-*-image, nano-banana-*) transparently via google.image().
 */

import { specToAspectRatio } from '$lib/utils/image'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateImage } from 'ai'
import { isGoogleImageModel } from '../../sdk/providers/modelFetcher'
import { createTimeoutFetch } from '../../sdk/providers/fetch'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export function createGoogleProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL
  const googleSDK = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: baseUrl })

  return {
    id: 'google',
    name: 'Google AI Studio',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, signal } = options

      const result = await generateImage({
        model: googleSDK.image(model),
        prompt,
        aspectRatio: specToAspectRatio(spec, GOOGLE_ASPECT_RATIOS) as `${number}:${number}`,
        abortSignal: signal,
      })

      if (!result.images[0]?.base64) {
        throw new Error('No image data in Google response')
      }

      return { base64: result.images[0].base64 }
    },

    async listModels(): Promise<ImageModelInfo[]> {
      return fetchGoogleImageModels(baseUrl, config.apiKey)
    },
  }
}

/**
 * The aspect ratios the Gemini image models accept. There is no pixel parameter, and this
 * is a closed enum: an unlisted ratio is rejected, not rounded. Imagen's list is a subset.
 */
const GOOGLE_ASPECT_RATIOS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
] as const

async function fetchGoogleImageModels(baseUrl: string, apiKey?: string): Promise<ImageModelInfo[]> {
  if (!apiKey) return getFallbackImageModels()

  const url =
    baseUrl.replace(/\/$/, '') + '/models?key=' + encodeURIComponent(apiKey) + '&pageSize=200'

  try {
    const fetchFn = createTimeoutFetch(30000, 'google-image-models')
    const response = await fetchFn(url)
    if (!response.ok) return getFallbackImageModels()

    const data = await response.json()
    if (!data.models || !Array.isArray(data.models)) return getFallbackImageModels()

    const models: ImageModelInfo[] = data.models
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) => {
        const id = m.name.replace(/^models\//, '')
        return m.supportedGenerationMethods?.includes('predict') || isGoogleImageModel(id)
      })
      .map((m: { name: string; displayName?: string; description?: string }) => {
        const id = m.name.replace(/^models\//, '')
        return {
          id,
          name: m.displayName || id,
          description: m.description,
          supportsImg2Img: supportsImg2Img(id),
        }
      })

    return models.length > 0 ? models : getFallbackImageModels()
  } catch (error) {
    console.error('[Google Image] Failed to fetch models:', error)
    return getFallbackImageModels()
  }
}

function supportsImg2Img(id: string): boolean {
  // Gemini image models (nano banana) and Imagen 4 support img2img
  return isGoogleImageModel(id) || id === 'imagen-4.0-generate-001'
}

function getFallbackImageModels(): ImageModelInfo[] {
  return [
    {
      id: 'imagen-4.0-generate-001',
      name: 'Imagen 4',
      description: 'Vertex served Imagen 4.0 model',
      supportsImg2Img: supportsImg2Img('imagen-4.0-generate-001'),
    },
    {
      id: 'imagen-4.0-ultra-generate-001',
      name: 'Imagen 4 Ultra',
      description: 'Vertex served Imagen 4.0 ultra model',
      supportsImg2Img: supportsImg2Img('imagen-4.0-ultra-generate-001'),
    },
    {
      id: 'imagen-4.0-fast-generate-001',
      name: 'Imagen 4 Fast',
      description: 'Vertex served Imagen 4.0 Fast model',
      supportsImg2Img: supportsImg2Img('imagen-4.0-fast-generate-001'),
    },
  ]
}
