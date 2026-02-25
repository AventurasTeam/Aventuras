/**
 * Zhipu CogView Provider
 *
 * Direct HTTP calls to Zhipu's CogView API for image generation.
 * - txt2img: POST to open.bigmodel.cn
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

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

export function createZhipuProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'zhipu',
    name: 'Zhipu CogView',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, size, signal } = options

      const body = {
        model: model || 'cogview-4-250304',
        prompt,
        size,
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
        serviceId: 'zhipu-image',
      })

      const data = await response.json()
      const imageData = data?.data?.[0]

      if (imageData?.b64_json) {
        return { base64: imageData.b64_json }
      }
      if (imageData?.url) {
        const imgResponse = await fetch(imageData.url)
        const blob = await imgResponse.blob()
        const buffer = await blob.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
        return { base64 }
      }

      throw new Error('No image data in Zhipu response')
    },

    async listModels(): Promise<ImageModelInfo[]> {
      return [
        {
          id: 'cogview-4-250304',
          name: 'CogView 4',
          description: 'Zhipu CogView image generation',
          supportsSizes: ['512x512', '1024x1024'],
          supportsImg2Img: false,
        },
        {
          id: 'cogview-3-flash',
          name: 'CogView 3 Flash',
          description: 'Fast image generation',
          supportsSizes: ['512x512', '1024x1024'],
          supportsImg2Img: false,
        },
      ]
    },

    supportsImg2Img(_modelId: string): boolean {
      return false
    },
  }
}
