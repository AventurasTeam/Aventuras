/**
 * Chutes Image Provider
 *
 * Direct HTTP calls to api.chutes.ai.
 * - txt2img: POST /v1/images/generations (JSON)
 * - img2img: Not supported
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageFetch } from './fetchAdapter'

const DEFAULT_BASE_URL = 'https://api.chutes.ai/v1'
const CHUTES_API_ENDPOINT = 'https://api.chutes.ai/chutes/?include_public=true&limit=200'

export function createChutesProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'chutes',
    name: 'Chutes',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, size, signal } = options

      const body = {
        model,
        prompt,
        size,
        n: 1,
        response_format: 'b64_json',
      }

      const response = await imageFetch({
        url: `${baseUrl}/images/generations`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        serviceId: 'chutes-image',
      })

      const data = await response.json()
      const imageData = data?.data?.[0]
      if (!imageData?.b64_json) throw new Error('No image data in Chutes response')

      return { base64: imageData.b64_json }
    },

    async listModels(apiKey?: string): Promise<ImageModelInfo[]> {
      try {
        const headers: Record<string, string> = {}
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

        const response = await fetch(CHUTES_API_ENDPOINT, { headers })
        if (!response.ok) return getFallbackModels()

        const data = await response.json()
        const items = data.items || []

        const imageModels = items.filter(
          (item: { standard_template?: string | null; name?: string }) => {
            if (item.standard_template === 'diffusion') return true
            if (item.standard_template === null) {
              const name = item.name?.toLowerCase() || ''
              return name.includes('image') || name.includes('z-image')
            }
            return false
          },
        )

        if (imageModels.length === 0) return getFallbackModels()

        const models: ImageModelInfo[] = imageModels.map(
          (item: { name: string; tagline?: string }) => {
            const name = item.name
            const nameLower = name.toLowerCase()
            const supportsImg2Img =
              nameLower.includes('edit') ||
              (nameLower.includes('qwen-image') && !nameLower.includes('turbo'))

            return {
              id: name,
              name: formatName(name),
              description: item.tagline || undefined,
              supportsSizes: ['576x576', '1024x1024', '2048x2048'],
              supportsImg2Img,
            }
          },
        )

        models.sort((a, b) => {
          const aL = a.id.toLowerCase()
          const bL = b.id.toLowerCase()
          if (aL === 'z-image-turbo') return -1
          if (bL === 'z-image-turbo') return 1
          if (aL.includes('qwen') && !bL.includes('qwen')) return -1
          if (bL.includes('qwen') && !aL.includes('qwen')) return 1
          return a.name.localeCompare(b.name)
        })

        return models
      } catch {
        return getFallbackModels()
      }
    },

    supportsImg2Img(_modelId: string): boolean {
      return false
    },
  }
}

function formatName(name: string): string {
  if (name === 'z-image-turbo') return 'Z Image Turbo'
  if (name.toLowerCase().includes('qwen-image-edit')) return 'Qwen Image Edit'
  if (name === 'qwen-image') return 'Qwen Image'
  return name
    .split(/[-_/]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function getFallbackModels(): ImageModelInfo[] {
  return [
    {
      id: 'z-image-turbo',
      name: 'Z Image Turbo',
      description: 'Fast, efficient image generation',
      supportsSizes: ['576x576', '1024x1024', '2048x2048'],
      supportsImg2Img: false,
    },
    {
      id: 'qwen-image-edit-2511',
      name: 'Qwen Image Edit',
      description: 'Image editing with reference images',
      supportsSizes: ['512x512', '1024x1024', '2048x2048'],
      supportsImg2Img: true,
    },
  ]
}
