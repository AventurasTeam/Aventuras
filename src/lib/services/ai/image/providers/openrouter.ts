/**
 * OpenRouter Image Provider
 *
 * Generates through `@openrouter/ai-sdk-provider` (POST /images). Models come from GET /models,
 * filtered on image output.
 */

import * as z from 'zod'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { specToAspectRatio, type ImageSizeTier } from '#lib/utils/image.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { parseModelList } from './parseModelList'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

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

/** The aspect ratios the `/images` API lists; OpenRouter clamps one to what the model supports. */
const OPENROUTER_ASPECT_RATIOS = [
  '1:1',
  '1:2',
  '1:4',
  '1:8',
  '2:1',
  '2:3',
  '2.35:1',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:2',
  '5:4',
  '5:7',
  '7:5',
  '8:1',
  '9:16',
  '16:9',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '9:21',
  '21:9',
] as const

type OpenRouterResolution = '512' | '768' | '1K' | '1.5K' | '2K' | '4K'

/** Each tier's resolution matches its pixel long edge. */
const OPENROUTER_IMAGE_SIZE: Record<ImageSizeTier, OpenRouterResolution> = {
  tiny: '512',
  small: '1K',
  medium: '1.5K',
  large: '2K',
}

export function createOpenRouterProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL
  const openrouter = createOpenRouter({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('openrouter-image'),
  })

  return {
    id: 'openrouter',
    name: 'OpenRouter',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options

      return generateSdkImage({
        model: openrouter.imageModel(model),
        prompt,
        referenceImages,
        aspectRatio: specToAspectRatio(spec, OPENROUTER_ASPECT_RATIOS) as `${number}:${number}`,
        providerOptions: { openrouter: { resolution: OPENROUTER_IMAGE_SIZE[spec.size] } },
        signal,
      })
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
