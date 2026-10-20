/**
 * OpenRouter Image Provider
 *
 * Uses OpenRouter's chat/completions endpoint with modalities: ["image"]
 * to generate images. OpenRouter wraps multiple image models (Flux, Gemini,
 * Sourceful, etc.) behind a single API.
 *
 * - txt2img: POST /chat/completions with modalities + image_config
 * - img2img: Same endpoint with base64 image in user message content
 * - Model discovery: GET /models, filter by output_modalities includes "image"
 */

import * as z from 'zod'
import {
  specToAspectRatio,
  base64ImageMime,
  type ImageSpec,
  type ImageSizeTier,
} from '#lib/utils/image.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageFetch, imageGetFetch } from './fetchAdapter'
import { parseModelList } from './parseModelList'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models'

const optionalString = z.string().optional().catch(undefined)
const modalities = z.array(z.string()).catch([])

const OpenRouterModel = z.object({
  id: z.string(),
  name: optionalString,
  description: optionalString,
  architecture: z
    .object({ input_modalities: modalities, output_modalities: modalities })
    .catch({ input_modalities: [], output_modalities: [] }),
  pricing: z
    .object({ prompt: optionalString, completion: optionalString, image: optionalString })
    .catch({}),
})

/** A price string as a number; zero, negative and unparseable prices read as unknown. */
function positivePrice(value: string | undefined): number | undefined {
  const parsed = parseFloat(value ?? '')
  return parsed > 0 ? parsed : undefined
}

/** The aspect ratios OpenRouter documents. */
const OPENROUTER_ASPECT_RATIOS = [
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

/** `0.5K` is accepted by a single model, so `1K` is the floor and `tiny` collapses onto it. */
const OPENROUTER_IMAGE_SIZE: Record<ImageSizeTier, string> = {
  tiny: '1K',
  small: '1K',
  medium: '2K',
  large: '4K',
}

function specToImageConfig(spec: ImageSpec): Record<string, string> {
  return {
    aspect_ratio: specToAspectRatio(spec, OPENROUTER_ASPECT_RATIOS),
    image_size: OPENROUTER_IMAGE_SIZE[spec.size],
  }
}

export function createOpenRouterProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'openrouter',
    name: 'OpenRouter',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options

      // Build user message content
      const contentParts: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]

      // img2img: attach reference images as image_url content parts
      if (referenceImages?.length) {
        for (const img of referenceImages) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${base64ImageMime(img)};base64,${img}` },
          })
        }
      }

      const imageConfig = specToImageConfig(spec)

      const body: Record<string, unknown> = {
        model,
        messages: [
          {
            role: 'user',
            content: contentParts,
          },
        ],
        modalities: ['image'],
        stream: false,
      }

      if (Object.keys(imageConfig).length > 0) {
        body.image_config = imageConfig
      }

      const response = await imageFetch({
        url: `${baseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        serviceId: 'openrouter-image',
      })

      const data = await response.json()

      // Extract image from response
      const message = data?.choices?.[0]?.message
      if (!message) throw new Error('No message in OpenRouter image response')

      // Images come in message.images array
      const images = message.images
      if (images?.length) {
        const imageUrl = images[0]?.image_url?.url
        if (imageUrl) {
          // Strip data URL prefix to get raw base64
          const base64 = imageUrl.replace(/^data:image\/[^;]+;base64,/, '')
          return { base64, revisedPrompt: message.content || undefined }
        }
      }

      throw new Error('No image data in OpenRouter response')
    },

    async listModels(apiKey?: string): Promise<ImageModelInfo[]> {
      const headers: Record<string, string> = {}
      const key = apiKey || config.apiKey
      if (key) headers['Authorization'] = `Bearer ${key}`

      const response = await imageGetFetch(MODELS_ENDPOINT, headers, {
        serviceId: 'openrouter-image-models',
      })
      return parseModelList(await response.json(), OpenRouterModel)
        .filter((m) => m.architecture.output_modalities.includes('image'))
        .map((m): ImageModelInfo => ({
          id: m.id,
          name: m.name || m.id,
          description: m.description,
          supportsImg2Img:
            m.architecture.input_modalities.includes('image') &&
            m.architecture.output_modalities.includes('image'),
          costPerImage: positivePrice(m.pricing.image),
          costPerTextToken: positivePrice(m.pricing.prompt),
          costPerImageToken: positivePrice(m.pricing.completion),
          inputModalities: m.architecture.input_modalities,
          outputModalities: m.architecture.output_modalities,
        }))
    },
  }
}
