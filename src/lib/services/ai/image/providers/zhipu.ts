/**
 * Z.AI (Zhipu) Image Provider
 *
 * Generates `glm-image` through the OpenAI Compatible SDK path against api.z.ai. Z.AI answers
 * `data[].url`, which the SDK downloads through the plugin transport. No endpoint lists models.
 */

import { specToPixels, formatImageSize, type ImageSpec } from '#lib/utils/image.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { generateOpenAICompatibleImage } from './openaiCompatibleProvider'

const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4'

// glm-image: each side 1024-2048 and a multiple of 32.
const MIN_SIDE = 1024
const MAX_SIDE = 2048
const SIDE_GRID = 32

/** The spec's pixels scaled to glm-image's limits, keeping the ratio. */
function fitSize(spec: ImageSpec): `${number}x${number}` {
  const { width, height } = specToPixels(spec)
  const upscale = Math.max(1, MIN_SIDE / Math.min(width, height))
  const downscale = Math.min(1, MAX_SIDE / (Math.max(width, height) * upscale))
  const scale = upscale * downscale
  const snap = (side: number) => Math.round((side * scale) / SIDE_GRID) * SIDE_GRID
  return formatImageSize({ width: snap(width), height: snap(height) })
}

export function createZhipuProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL

  return {
    id: 'zhipu',
    name: 'Z.AI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, signal } = options

      return generateOpenAICompatibleImage({
        baseUrl,
        apiKey: config.apiKey,
        serviceId: 'zhipu-image',
        model,
        prompt,
        size: fitSize(spec),
        signal,
      })
    },

    async listModels(): Promise<ImageModelInfo[]> {
      return [{ id: 'glm-image', name: 'GLM-Image', supportsImg2Img: false }]
    },
  }
}
