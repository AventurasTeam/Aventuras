// Image generation through `@ai-sdk/google`.

import { specToAspectRatio } from '#lib/utils/image.ts'
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
      const { model, prompt, spec, referenceImages, signal } = options

      const result = await generateImage({
        model: googleSDK.image(model),
        prompt: referenceImages?.length ? { text: prompt, images: referenceImages } : prompt,
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
 * is a closed enum: an unlisted ratio is rejected, not rounded.
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
  if (!apiKey) return []

  const url =
    baseUrl.replace(/\/$/, '') + '/models?key=' + encodeURIComponent(apiKey) + '&pageSize=200'

  const fetchFn = createTimeoutFetch(30000, 'google-image-models')
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`Google models request failed: HTTP ${response.status}`)

  const data = await response.json()
  if (!Array.isArray(data.models)) throw new Error('Google models response has no models array')

  const models: ImageModelInfo[] = []
  for (const m of data.models as GoogleModelEntry[]) {
    const id = m.name.replace(/^models\//, '')
    if (!isGoogleImageModel(id)) continue
    models.push({
      id,
      name: m.displayName || id,
      description: m.description,
      supportsImg2Img: true,
    })
  }
  return models
}

interface GoogleModelEntry {
  name: string
  displayName?: string
  description?: string
}
