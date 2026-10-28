/**
 * Z.AI (Zhipu) Image Provider
 *
 * Generates through the OpenAI Compatible SDK path against api.z.ai or open.bigmodel.cn. Both answer
 * `data[].url`, which the SDK downloads through the plugin transport. No endpoint lists image models,
 * so the models and their size limits come from the API reference.
 */

import { specToPixels, formatImageSize, type ImageSpec } from '#lib/utils/image.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { generateOpenAICompatibleImage } from './openaiCompatible'

const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4'

const BIGMODEL_HOST = 'open.bigmodel.cn'

interface SizeLimits {
  minSide: number
  maxSide: number
  grid: number
  maxPixels: number
}

// The API reference's custom `size` rules. The guides allow glm-image a smaller side (512), so the
// reference's 1024 is the floor every reading accepts.
const GLM_IMAGE: SizeLimits = { minSide: 1024, maxSide: 2048, grid: 32, maxPixels: 2 ** 22 }
const COGVIEW: SizeLimits = { minSide: 512, maxSide: 2048, grid: 16, maxPixels: 2 ** 21 }

const isCogView = (model: string): boolean => model.trim().toLowerCase().startsWith('cogview-')

const limitsFor = (model: string): SizeLimits => (isCogView(model) ? COGVIEW : GLM_IMAGE)

const ZHIPU_IMAGE_MODELS = new Map([
  ['glm-image', 'GLM-Image'],
  ['cogview-4-250304', 'CogView-4 (250304)'],
  ['cogview-4', 'CogView-4'],
  ['cogview-3-flash', 'CogView-3 Flash'],
])

/** The spec's pixels scaled into the limits, keeping the ratio. */
function fitSize(spec: ImageSpec, limits: SizeLimits): `${number}x${number}` {
  const { minSide, maxSide, grid, maxPixels } = limits
  const { width, height } = specToPixels(spec)
  const upscale = Math.max(1, minSide / Math.min(width, height))
  const downscale = Math.min(
    1,
    maxSide / (Math.max(width, height) * upscale),
    Math.sqrt(maxPixels / (width * height * upscale ** 2)),
  )
  const scale = upscale * downscale
  const snap = (side: number, round: (cells: number) => number) =>
    round((side * scale) / grid) * grid

  const snapped = { width: snap(width, Math.round), height: snap(height, Math.round) }
  // Rounding both edges up can cross the pixel cap; rounding both down cannot.
  return formatImageSize(
    snapped.width * snapped.height > maxPixels
      ? { width: snap(width, Math.floor), height: snap(height, Math.floor) }
      : snapped,
  )
}

export function createZhipuProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl) || DEFAULT_BASE_URL

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
        size: fitSize(spec, limitsFor(model)),
        signal,
      })
    },

    // api.z.ai answers `cogview-3-flash` as an unknown model, so CogView is listed for BigModel only.
    async listModels(): Promise<ImageModelInfo[]> {
      const onBigModel = new URL(baseUrl).hostname === BIGMODEL_HOST
      return [...ZHIPU_IMAGE_MODELS]
        .filter(([id]) => onBigModel || !isCogView(id))
        .map(([id, name]) => ({ id, name, supportsImg2Img: false }))
    },
  }
}
