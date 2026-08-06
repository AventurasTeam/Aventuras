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

import { specToAspectRatio, type ImageSpec, type ImageSizeTier } from '$lib/utils/image'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageFetch } from './fetchAdapter'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models'

interface OpenRouterModel {
  id: string
  name?: string
  description?: string
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
  }
  pricing?: {
    prompt?: string
    completion?: string
    image?: string
  }
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
            image_url: { url: `data:image/png;base64,${img}` },
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
      try {
        const headers: Record<string, string> = {}
        const key = apiKey || config.apiKey
        if (key) headers['Authorization'] = `Bearer ${key}`

        const response = await fetch(MODELS_ENDPOINT, { headers })
        if (!response.ok) return getFallbackModels()

        const data = await response.json()
        const models = data?.data || []

        // Filter for models that have "image" in output_modalities
        const imageModels = models.filter((m: OpenRouterModel) =>
          m.architecture?.output_modalities?.includes('image'),
        )

        if (imageModels.length === 0) return getFallbackModels()

        return imageModels.map((m: OpenRouterModel): ImageModelInfo => {
          const inputMods = m.architecture?.input_modalities || []
          const outputMods = m.architecture?.output_modalities || []
          const supportsImg2Img = inputMods.includes('image') && outputMods.includes('image')

          // Parse cost from pricing.image if available
          let costPerImage: number | undefined
          if (m.pricing?.image) {
            const parsed = parseFloat(m.pricing.image)
            if (!isNaN(parsed) && parsed > 0) costPerImage = parsed
          }

          let costPerTextToken: number | undefined
          if (m.pricing?.prompt) {
            const parsed = parseFloat(m.pricing.prompt)
            if (!isNaN(parsed) && parsed > 0) costPerTextToken = parsed
          }

          let costPerImageToken: number | undefined
          if (m.pricing?.completion) {
            const parsed = parseFloat(m.pricing.completion)
            if (!isNaN(parsed) && parsed > 0) costPerImageToken = parsed
          }

          return {
            id: m.id,
            name: m.name || m.id,
            description: m.description,
            supportsImg2Img,
            costPerImage,
            costPerTextToken,
            costPerImageToken,
            inputModalities: inputMods,
            outputModalities: outputMods,
          }
        })
      } catch {
        return getFallbackModels()
      }
    },
  }
}

function getFallbackModels(): ImageModelInfo[] {
  return [
    {
      id: 'google/gemini-2.5-flash-image',
      name: 'Gemini 2.5 Flash Image (Nano Banana)',
      description: 'Google Gemini with image generation capabilities',
      supportsImg2Img: true,
    },
    {
      id: 'google/gemini-3.1-flash-image-preview',
      name: 'Gemini 3.1 Flash Image Preview (Nano Banana 2)',
      description: 'Next-gen Gemini image generation with extended aspect ratios',
      supportsImg2Img: true,
    },
    {
      id: 'bytedance-seed/seedream-4.5',
      name: 'Seedream 4.5',
      description: 'ByteDance Seed high-quality image generation',
      supportsImg2Img: true,
    },
    {
      id: 'black-forest-labs/flux.2-pro',
      name: 'FLUX.2 Pro',
      description: 'Professional quality image generation',
      supportsImg2Img: true,
    },
    {
      id: 'openai/gpt-5-image',
      name: 'GPT-5 Image',
      description: 'OpenAI image generation via OpenRouter',
      supportsImg2Img: true,
    },
  ]
}
