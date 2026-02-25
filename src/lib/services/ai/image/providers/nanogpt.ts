/**
 * NanoGPT Image Provider
 *
 * Direct HTTP calls to nano-gpt.com API.
 * - txt2img: POST /images/generations (JSON)
 * - img2img: Same endpoint + imageDataUrl in body
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageFetch } from './fetchAdapter'

const DEFAULT_BASE_URL = 'https://nano-gpt.com/api/v1'
const MODELS_ENDPOINT = 'https://nano-gpt.com/api/models'

// Known img2img capable models/tags
const IMG2IMG_TAGS = new Set(['image-to-image', 'image-edit'])

export function createNanoGPTProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'nanogpt',
    name: 'NanoGPT',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, size, referenceImages, signal } = options
      const [width, height] = size.split('x').map(Number)

      const body: Record<string, unknown> = {
        model,
        prompt,
        width: width || 1024,
        height: height || 1024,
      }

      // img2img: pass reference as imageDataUrl
      if (referenceImages?.length) {
        body.imageDataUrl = `data:image/png;base64,${referenceImages[0]}`
      }

      const response = await imageFetch({
        url: `${baseUrl}/images/generations`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        serviceId: 'nanogpt-image',
      })

      const data = await response.json()
      const imageData = data?.data?.[0]

      if (imageData?.b64_json) {
        return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
      }
      if (imageData?.url) {
        // Fetch the image URL and convert to base64
        const imgResponse = await fetch(imageData.url)
        const blob = await imgResponse.blob()
        const buffer = await blob.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
        return { base64, revisedPrompt: imageData.revised_prompt }
      }

      throw new Error('No image data in NanoGPT response')
    },

    async listModels(): Promise<ImageModelInfo[]> {
      try {
        const response = await fetch(MODELS_ENDPOINT)
        if (!response.ok) return getFallbackModels()

        const data = await response.json()
        const imageModels = data?.models?.image || {}
        const entries = Object.values(imageModels) as Array<{
          name?: string
          model?: string
          description?: string
          cost?: Record<string, number>
          resolutions?: Array<{ value: string; comment?: string }>
          tags?: string[]
          supportsMultipleImg2Img?: boolean
        }>

        if (entries.length === 0) return getFallbackModels()

        return entries.map((m) => {
          const supportsSizes = m.resolutions?.map((r) => r.value.replace('*', 'x')) || [
            '512x512',
            '1024x1024',
          ]
          const supportsImg2Img =
            m.tags?.some((t) => IMG2IMG_TAGS.has(t)) || m.supportsMultipleImg2Img || false

          let costPerImage: number | undefined
          if (m.cost && typeof m.cost === 'object') {
            const costs = Object.values(m.cost).filter((c) => typeof c === 'number')
            if (costs.length > 0) costPerImage = costs.reduce((a, b) => a + b, 0) / costs.length
          }

          return {
            id: m.model || m.name || '',
            name: m.name || m.model || '',
            description: m.description,
            supportsSizes,
            supportsImg2Img,
            costPerImage,
          }
        })
      } catch {
        return getFallbackModels()
      }
    },

    supportsImg2Img(_modelId: string): boolean {
      // NanoGPT supports img2img for models tagged with image-to-image
      // The model listing provides this info; here we default to true for known models
      return true
    },
  }
}

function getFallbackModels(): ImageModelInfo[] {
  return [
    {
      id: 'z-image-turbo',
      name: 'Image Turbo',
      description: 'Fast, efficient image generation',
      supportsSizes: ['512x512', '1024x1024'],
      supportsImg2Img: false,
    },
    {
      id: 'flux-kontext',
      name: 'Flux Kontext',
      description: 'Context-aware image generation',
      supportsSizes: ['512x512', '1024x1024'],
      supportsImg2Img: true,
    },
  ]
}
