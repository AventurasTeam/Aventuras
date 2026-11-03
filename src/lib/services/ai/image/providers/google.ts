// Image generation through `@ai-sdk/google`.

import type { ImageModelCapabilities } from '#lib/types/index.ts'
import { pickResolution, specToAspectRatio } from '#lib/utils/image.ts'
import { resolveBaseUrl } from './baseUrls'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { isGoogleImageModel } from '../../sdk/providers/modelFetcher'
import { imageGetFetch } from './fetchAdapter'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

export function createGoogleProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = resolveBaseUrl('google', config.baseUrl)
  const googleSDK = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('google-image'),
  })

  return {
    id: 'google',
    name: 'Google AI Studio',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, modelInfo, referenceImages, signal } = options
      const imageSize = pickResolution(spec, modelInfo?.supportedResolutions)

      return generateSdkImage({
        model: googleSDK.image(model),
        prompt,
        referenceImages,
        aspectRatio: specToAspectRatio(
          spec,
          modelInfo?.supportedAspectRatios?.length
            ? modelInfo.supportedAspectRatios
            : GOOGLE_ASPECT_RATIOS,
        ) as `${number}:${number}`,
        providerOptions: imageSize ? { google: { imageConfig: { imageSize } } } : undefined,
        signal,
      })
    },

    async listModels(_apiKey?: string, signal?: AbortSignal): Promise<ImageModelInfo[]> {
      return fetchGoogleImageModels(baseUrl, config.apiKey, signal)
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

const imageModel = (
  maxReferenceImages: number,
  aspectRatios: readonly string[],
  supportedResolutions?: readonly string[],
): ImageModelCapabilities => ({
  supportsImg2Img: true,
  maxReferenceImages,
  supportedAspectRatios: [...aspectRatios],
  ...(supportedResolutions && { supportedResolutions: [...supportedResolutions] }),
})

// From the Gemini image generation guide. For Flash Lite the guide's prose (1K, ten ratios) and
// tables (512, the wide ratios) disagree and nothing is probed, so it takes the narrower prose.
const GOOGLE_IMAGE_MODELS = new Map<string, ImageModelCapabilities>([
  ['gemini-3.1-flash-image', imageModel(14, GOOGLE_ASPECT_RATIOS, ['512', '1K', '2K', '4K'])],
  ['gemini-nano-banana-2.1', imageModel(14, GOOGLE_ASPECT_RATIOS, ['1K', '2K', '4K'])],
  ['gemini-3-pro-image', imageModel(14, STANDARD_ASPECT_RATIOS, ['1K', '2K', '4K'])],
  ['gemini-3.1-flash-lite-image', imageModel(14, STANDARD_ASPECT_RATIOS, ['1K'])],
  ['gemini-2.5-flash-image', imageModel(3, STANDARD_ASPECT_RATIOS)],
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

/** What generation reads for a model; `undefined` for an id that is not an image model. */
export const googleModelCapabilities = (model: string): ImageModelCapabilities | undefined =>
  isSdkImageModel(model) ? googleImageCapabilities(model) : undefined

async function fetchGoogleImageModels(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<ImageModelInfo[]> {
  if (!apiKey) return []

  // The key goes in a header: the debug log records the request URL.
  const response = await imageGetFetch(
    `${baseUrl}/models?pageSize=200`,
    { 'x-goog-api-key': apiKey },
    { serviceId: 'google-image-models', signal },
  )

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
