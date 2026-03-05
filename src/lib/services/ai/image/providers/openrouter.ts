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

/**
 * Map a WIDTHxHEIGHT size string to OpenRouter's image_config format.
 * Returns { aspect_ratio, image_size } or empty object if no mapping.
 */
function mapSizeToImageConfig(size: string): Record<string, string> {
  const parts = size.split('x').map(Number)
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return {}

  const [width, height] = parts

  // Determine image_size tier based on the larger dimension
  // Note: '0.5K' is only supported by a single model, so we use '1K' as the minimum
  const maxDim = Math.max(width, height)
  let imageSize: string
  if (maxDim <= 1280) {
    imageSize = '1K'
  } else if (maxDim <= 2560) {
    imageSize = '2K'
  } else {
    imageSize = '4K'
  }

  // Determine aspect ratio from width:height
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height)
  const rw = width / d
  const rh = height / d

  // Map to OpenRouter's supported aspect ratios
  const ratioKey = `${rw}:${rh}`
  const supportedRatios = new Set([
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
  ])

  const aspectRatio = supportedRatios.has(ratioKey) ? ratioKey : '1:1'

  return { aspect_ratio: aspectRatio, image_size: imageSize }
}

export function createOpenRouterProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'openrouter',
    name: 'OpenRouter',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, size, referenceImages, signal } = options

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

      const imageConfig = mapSizeToImageConfig(size)

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
            supportsSizes: OPENROUTER_SUPPORTED_SIZES,
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

/**
 * All WIDTHxHEIGHT sizes derived from OpenRouter's documented aspect ratios at 1K tier.
 * OpenRouter handles fallback server-side if a model doesn't support a specific ratio,
 * so it's safe to offer the full set for all models.
 *
 * Aspect ratios → pixel sizes (1K tier):
 *   1:1 → 1024x1024, 2:3 → 832x1248, 3:2 → 1248x832, 3:4 → 864x1184,
 *   4:3 → 1184x864, 4:5 → 896x1152, 5:4 → 1152x896, 9:16 → 768x1344,
 *   16:9 → 1344x768, 21:9 → 1536x672
 */
export const OPENROUTER_SUPPORTED_SIZES = [
  '1024x1024',
  '832x1248',
  '1248x832',
  '864x1184',
  '1184x864',
  '896x1152',
  '1152x896',
  '768x1344',
  '1344x768',
  '1536x672',
]

function getFallbackModels(): ImageModelInfo[] {
  return [
    {
      id: 'google/gemini-2.5-flash-image',
      name: 'Gemini 2.5 Flash Image (Nano Banana)',
      description: 'Google Gemini with image generation capabilities',
      supportsSizes: OPENROUTER_SUPPORTED_SIZES,
      supportsImg2Img: true,
    },
    {
      id: 'google/gemini-3.1-flash-image-preview',
      name: 'Gemini 3.1 Flash Image Preview (Nano Banana 2)',
      description: 'Next-gen Gemini image generation with extended aspect ratios',
      supportsSizes: OPENROUTER_SUPPORTED_SIZES,
      supportsImg2Img: true,
    },
    {
      id: 'bytedance-seed/seedream-4.5',
      name: 'Seedream 4.5',
      description: 'ByteDance Seed high-quality image generation',
      supportsSizes: OPENROUTER_SUPPORTED_SIZES,
      supportsImg2Img: true,
    },
    {
      id: 'black-forest-labs/flux.2-pro',
      name: 'FLUX.2 Pro',
      description: 'Professional quality image generation',
      supportsSizes: OPENROUTER_SUPPORTED_SIZES,
      supportsImg2Img: true,
    },
    {
      id: 'openai/gpt-5-image',
      name: 'GPT-5 Image',
      description: 'OpenAI image generation via OpenRouter',
      supportsSizes: OPENROUTER_SUPPORTED_SIZES,
      supportsImg2Img: true,
    },
  ]
}
