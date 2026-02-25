/**
 * OpenAI Image Provider
 *
 * Direct HTTP calls to OpenAI-compatible image APIs.
 * - txt2img: POST /images/generations (JSON)
 * - img2img: POST /images/edits (FormData)
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageFetch } from './fetchAdapter'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export function createOpenAIProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'openai',
    name: 'OpenAI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, size, referenceImages, signal } = options

      if (referenceImages?.length) {
        return generateWithEdits(
          baseUrl,
          config.apiKey,
          model,
          prompt,
          size,
          referenceImages,
          signal,
        )
      }

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
        serviceId: 'openai-image',
      })

      const data = await response.json()
      const imageData = data?.data?.[0]
      if (!imageData?.b64_json) throw new Error('No image data in OpenAI response')

      return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
    },

    async listModels(): Promise<ImageModelInfo[]> {
      return getOpenAIModels()
    },

    supportsImg2Img(modelId: string): boolean {
      return modelId === 'dall-e-2' || modelId === 'gpt-image-1'
    },
  }
}

async function generateWithEdits(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  referenceImages: string[],
  signal?: AbortSignal,
): Promise<ImageGenerateResult> {
  const formData = new FormData()
  formData.append('model', model)
  formData.append('prompt', prompt)
  formData.append('size', size)
  formData.append('n', '1')
  formData.append('response_format', 'b64_json')

  // Convert base64 to blob for the image field
  const imageBytes = Uint8Array.from(atob(referenceImages[0]), (c) => c.charCodeAt(0))
  const imageBlob = new Blob([imageBytes], { type: 'image/png' })
  formData.append('image', imageBlob, 'reference.png')

  const response = await imageFetch({
    url: `${baseUrl}/images/edits`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Don't set Content-Type - let FormData set the boundary
    },
    body: formData,
    signal,
    serviceId: 'openai-image-edit',
  })

  const data = await response.json()
  const imageData = data?.data?.[0]
  if (!imageData?.b64_json) throw new Error('No image data in OpenAI edits response')

  return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
}

function getOpenAIModels(): ImageModelInfo[] {
  return [
    {
      id: 'dall-e-3',
      name: 'DALL-E 3',
      description: 'High quality image generation',
      supportsSizes: ['1024x1024', '1024x1792', '1792x1024'],
      supportsImg2Img: false,
    },
    {
      id: 'dall-e-2',
      name: 'DALL-E 2',
      description: 'Image generation with editing support',
      supportsSizes: ['256x256', '512x512', '1024x1024'],
      supportsImg2Img: true,
    },
    {
      id: 'gpt-image-1',
      name: 'GPT Image 1',
      description: 'GPT-powered image generation',
      supportsSizes: ['1024x1024', '1024x1792', '1792x1024'],
      supportsImg2Img: true,
    },
  ]
}
