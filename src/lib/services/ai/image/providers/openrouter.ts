/**
 * OpenRouter Image Provider
 *
 * Generates through `@openrouter/ai-sdk-provider` (POST /images). Models come from
 * GET /images/models; the text `/models` list omits the image-only ones.
 */

import * as z from 'zod'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { ImageModelCapabilities } from '#lib/types/index.ts'
import { isAspectRatio, pickResolution, specToAspectRatio } from '#lib/utils/image.ts'
import { endpoint } from '#lib/utils/url.ts'
import { resolveBaseUrl } from './baseUrls'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { architectureSchema, nonEmpty, optionalNumber, optionalString } from './modelCatalogue'
import { parseModelList } from './parseModelList'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'


const OpenRouterModel = z.object({
  id: z.string(),
  name: optionalString,
  description: optionalString,
  architecture: architectureSchema,
  supported_parameters: z
    .object({
      resolution: z
        .object({ values: z.array(z.string()) })
        .optional()
        .catch(undefined),
      aspect_ratio: z
        .object({ values: z.array(z.string()) })
        .optional()
        .catch(undefined),
      input_references: z
        .object({ min: optionalNumber, max: optionalNumber })
        .optional()
        .catch(undefined),
    })
    .catch({}),
})

type OpenRouterModel = z.output<typeof OpenRouterModel>

function toCapabilities({
  architecture,
  supported_parameters: params,
}: OpenRouterModel): ImageModelCapabilities {
  const refs = params.input_references
  const maxReferenceImages = refs?.max && refs.max > 0 ? refs.max : undefined

  // A model that takes images but lists no reference count still takes references; one whose
  // inputs could not be read stays unknown.
  const inputs = architecture?.input_modalities
  let supportsImg2Img: boolean | undefined
  if (maxReferenceImages || inputs?.includes('image')) supportsImg2Img = true
  else if (inputs) supportsImg2Img = false

  return {
    supportsImg2Img,
    maxReferenceImages,
    requiresReferenceImage: (refs?.min ?? 0) >= 1 ? true : undefined,
    supportedResolutions: nonEmpty(params.resolution?.values),
    supportedAspectRatios: nonEmpty(params.aspect_ratio?.values.filter(isAspectRatio)),
  }
}

function toModelInfo(m: OpenRouterModel): ImageModelInfo {
  return {
    id: m.id,
    name: m.name || m.id,
    description: m.description,
    inputModalities: m.architecture?.input_modalities,
    outputModalities: m.architecture?.output_modalities,
    ...toCapabilities(m),
  }
}

/** The ratios `/images` accepts in general, for a model whose own list is unknown. */
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

export function createOpenRouterProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = resolveBaseUrl('openrouter', config.baseUrl)
  const openrouter = createOpenRouter({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('openrouter-image'),
  })

  return {
    id: 'openrouter',
    name: 'OpenRouter',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, modelInfo, referenceImages, signal } = options
      const resolution = pickResolution(spec, modelInfo?.supportedResolutions)

      return generateSdkImage({
        model: openrouter.imageModel(model),
        prompt,
        referenceImages,
        aspectRatio: specToAspectRatio(
          spec,
          modelInfo?.supportedAspectRatios ?? [],
          OPENROUTER_ASPECT_RATIOS,
        ),
        providerOptions: { openrouter: resolution ? { resolution } : {} },
        signal,
      })
    },

    // Discovery works without a key; it is sent when set.
    async listModels(apiKey?: string, signal?: AbortSignal): Promise<ImageModelInfo[]> {
      const key = apiKey || config.apiKey
      const response = await imageGetFetch(
        endpoint(baseUrl, 'images/models'),
        key ? { Authorization: `Bearer ${key}` } : undefined,
        { serviceId: 'openrouter-image-models', signal },
      )
      return parseModelList(
        await response.json(),
        OpenRouterModel,
        'OpenRouter /images/models',
      ).map(toModelInfo)
    },
  }
}
