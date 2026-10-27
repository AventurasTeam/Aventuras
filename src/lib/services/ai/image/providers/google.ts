// Image generation through `@ai-sdk/google`.

import type { ImageModelCapabilities } from '#lib/types/index.ts'
import { specToAspectRatio } from '#lib/utils/image.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { isGoogleImageModel } from '../../sdk/providers/modelFetcher'
import { createTimeoutFetch } from '../../sdk/providers/fetch'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export function createGoogleProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl) || DEFAULT_BASE_URL
  const googleSDK = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('google-image'),
  })

  return {
    id: 'google',
    name: 'Google AI Studio',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options

      return generateSdkImage({
        model: googleSDK.image(model),
        prompt,
        referenceImages,
        aspectRatio: specToAspectRatio(spec, GOOGLE_ASPECT_RATIOS) as `${number}:${number}`,
        signal,
      })
    },

    async listModels(): Promise<ImageModelInfo[]> {
      return fetchGoogleImageModels(baseUrl, config.apiKey)
    },

    // `models.list` carries no image capabilities, so they come from the table.
    async getModelCapabilities(model: string): Promise<ImageModelCapabilities | undefined> {
      return isSdkImageModel(model) ? googleImageCapabilities(model) : undefined
    },
  }
}

/** The ratios every Gemini image model accepts. */
const STANDARD_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const

/**
 * The aspect ratios the Gemini image models accept. There is no pixel parameter, and this
 * is a closed enum: an unlisted ratio is rejected, not rounded.
 */
const GOOGLE_ASPECT_RATIOS = [...STANDARD_ASPECT_RATIOS, '1:4', '1:8', '4:1', '8:1'] as const

// From the Gemini image generation guide. For Flash Lite the guide's prose (1K, ten ratios) and
// tables (512, the wide ratios) disagree and nothing is probed, so it takes the narrower prose.
const GOOGLE_IMAGE_MODELS = new Map<string, ImageModelCapabilities>([
  [
    'gemini-3.1-flash-image',
    {
      supportsImg2Img: true,
      maxReferenceImages: 14,
      supportedResolutions: ['512', '1K', '2K', '4K'],
      supportedAspectRatios: [...GOOGLE_ASPECT_RATIOS],
    },
  ],
  [
    'gemini-nano-banana-2.1',
    {
      supportsImg2Img: true,
      maxReferenceImages: 14,
      supportedResolutions: ['1K', '2K', '4K'],
      supportedAspectRatios: [...GOOGLE_ASPECT_RATIOS],
    },
  ],
  [
    'gemini-3-pro-image',
    {
      supportsImg2Img: true,
      maxReferenceImages: 14,
      supportedResolutions: ['1K', '2K', '4K'],
      supportedAspectRatios: [...STANDARD_ASPECT_RATIOS],
    },
  ],
  [
    'gemini-3.1-flash-lite-image',
    {
      supportsImg2Img: true,
      maxReferenceImages: 14,
      supportedResolutions: ['1K'],
      supportedAspectRatios: [...STANDARD_ASPECT_RATIOS],
    },
  ],
  [
    'gemini-2.5-flash-image',
    {
      supportsImg2Img: true,
      maxReferenceImages: 3,
      supportedAspectRatios: [...STANDARD_ASPECT_RATIOS],
    },
  ],
])

/** A preview without an entry of its own is its generally available model. */
function googleImageCapabilities(id: string): ImageModelCapabilities {
  return (
    GOOGLE_IMAGE_MODELS.get(id) ??
    GOOGLE_IMAGE_MODELS.get(id.replace(/-preview$/, '')) ?? { supportsImg2Img: true }
  )
}

/** The SDK refuses a Google image model whose id does not start with `gemini-`. */
const isSdkImageModel = (id: string): boolean => id.startsWith('gemini-') && isGoogleImageModel(id)

async function fetchGoogleImageModels(baseUrl: string, apiKey?: string): Promise<ImageModelInfo[]> {
  if (!apiKey) return []

  const url = baseUrl + '/models?key=' + encodeURIComponent(apiKey) + '&pageSize=200'

  const fetchFn = createTimeoutFetch(30000, 'google-image-models')
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`Google models request failed: HTTP ${response.status}`)

  const data = await response.json()
  if (!Array.isArray(data.models)) throw new Error('Google models response has no models array')

  const models: ImageModelInfo[] = []
  for (const m of data.models as GoogleModelEntry[]) {
    const id = m.name.replace(/^models\//, '')
    if (!isSdkImageModel(id)) continue
    models.push({
      id,
      name: m.displayName || id,
      description: m.description,
      ...googleImageCapabilities(id),
    })
  }
  return models
}

interface GoogleModelEntry {
  name: string
  displayName?: string
  description?: string
}
