/**
 * OpenAI Image Provider
 *
 * Generates through `@ai-sdk/openai`. Models are fetched live from {baseUrl}/models and
 * filtered by image-capable prefixes; a failed fetch throws. `/models` carries no
 * capabilities, so those come from a table.
 */

import { createOpenAI } from '@ai-sdk/openai'
import * as z from 'zod'
import type { ImageModelCapabilities } from '#lib/types/index.ts'
import {
  formatImageSize,
  parseImageSize,
  pickSize,
  specToPixels,
  type ImageResolution,
} from '#lib/utils/image.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
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

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// Prefixes used to identify image-capable models in the /v1/models response
const IMAGE_MODEL_PREFIXES = ['gpt-image-', 'chatgpt-image-']

const isOpenAIImageModel = (id: string): boolean =>
  IMAGE_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix))

const ModelEntry = z.object({ id: z.string() })

const STANDARD_SIZES = ['1024x1024', '1536x1024', '1024x1536']

const imageModel = (supportedResolutions?: readonly string[]): ImageModelCapabilities => ({
  supportsImg2Img: true,
  maxReferenceImages: 16,
  ...(supportedResolutions && { supportedResolutions: [...supportedResolutions] }),
})

// From the image generation guide. `gpt-image-2` and `gpt-image-2.5-*` take any `WxH` within the
// pixel bounds, so they list no sizes; the other models take the standard three.
const OPENAI_IMAGE_MODELS = new Map<string, ImageModelCapabilities>([
  ['gpt-image-2', imageModel()],
  ['gpt-image-2.5-sunburst', imageModel()],
  ['gpt-image-2.5-flare', imageModel()],
  ['gpt-image-1.5', imageModel(STANDARD_SIZES)],
  ['gpt-image-1-mini', imageModel(STANDARD_SIZES)],
  ['chatgpt-image-latest', imageModel(STANDARD_SIZES)],
])

/** A dated snapshot without an entry of its own is its undated model. */
function openaiImageCapabilities(id: string): ImageModelCapabilities {
  return (
    OPENAI_IMAGE_MODELS.get(id) ??
    OPENAI_IMAGE_MODELS.get(id.replace(/-\d{4}-\d{2}-\d{2}$/, '')) ?? { supportsImg2Img: true }
  )
}

// Free-form sizes have a pixel floor: the tiny tier and non-square small are below it.
const MIN_PIXELS = 655_360
const EDGE_MULTIPLE = 16

/** The size raised, ratio kept, to the smallest multiple-of-16 pair above the pixel floor. */
function atLeastMinPixels({ width, height }: ImageResolution): ImageResolution {
  const pixels = width * height
  if (pixels >= MIN_PIXELS) return { width, height }

  const scale = Math.sqrt(MIN_PIXELS / pixels)
  const raise = (edge: number) => Math.ceil((edge * scale) / EDGE_MULTIPLE) * EDGE_MULTIPLE
  return { width: raise(width), height: raise(height) }
}

const isSizeString = (value: string | undefined): value is `${number}x${number}` =>
  parseImageSize(value) !== undefined

export function createOpenAIProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl) || DEFAULT_BASE_URL
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('openai-image'),
  })

  return {
    id: 'openai',
    name: 'OpenAI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, modelInfo, referenceImages, signal } = options
      const listed = pickSize(spec, modelInfo?.supportedResolutions)

      return generateSdkImage({
        model: openai.image(model),
        prompt,
        referenceImages,
        size: isSizeString(listed) ? listed : formatImageSize(atLeastMinPixels(specToPixels(spec))),
        signal,
      })
    },

    async listModels(apiKey: string): Promise<ImageModelInfo[]> {
      return fetchOpenAIImageModels(baseUrl, apiKey)
    },

    // `/models` carries no capabilities, so they come from the table.
    async getModelCapabilities(model: string): Promise<ImageModelCapabilities | undefined> {
      return isOpenAIImageModel(model) ? openaiImageCapabilities(model) : undefined
    },
  }
}

async function fetchOpenAIImageModels(baseUrl: string, apiKey: string): Promise<ImageModelInfo[]> {
  if (!apiKey) return []

  const response = await imageGetFetch(
    `${baseUrl}/models`,
    { Authorization: `Bearer ${apiKey}` },
    { serviceId: 'openai-image-models' },
  )
  return parseModelList(await response.json(), ModelEntry)
    .filter(({ id }) => isOpenAIImageModel(id))
    .map(({ id }) => ({ id, name: id, ...openaiImageCapabilities(id) }))
}
