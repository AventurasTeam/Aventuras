/**
 * Google Imagen Provider
 *
 * Direct HTTP calls to Google's Generative AI API for image generation.
 * - txt2img: POST to generativelanguage.googleapis.com
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

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export function createGoogleProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'google',
    name: 'Google Imagen',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, signal } = options

      const body = {
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
        },
      }

      const response = await imageFetch({
        url: `${baseUrl}/models/${model}:predict?key=${config.apiKey}`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        serviceId: 'google-image',
      })

      const data = await response.json()
      const predictions = data?.predictions
      if (!predictions?.[0]?.bytesBase64Encoded) {
        throw new Error('No image data in Google response')
      }

      return { base64: predictions[0].bytesBase64Encoded }
    },

    async listModels(): Promise<ImageModelInfo[]> {
      return getGoogleModels()
    },

    supportsImg2Img(_modelId: string): boolean {
      return false
    },
  }
}

function getGoogleModels(): ImageModelInfo[] {
  return [
    {
      id: 'imagen-3.0-generate-002',
      name: 'Imagen 3',
      description: "Google's latest image generation model",
      supportsSizes: ['512x512', '1024x1024'],
      supportsImg2Img: false,
    },
    {
      id: 'imagen-4.0-generate-001',
      name: 'Imagen 4',
      description: 'Next-gen image generation',
      supportsSizes: ['512x512', '1024x1024'],
      supportsImg2Img: false,
    },
  ]
}
