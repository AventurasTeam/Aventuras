import * as z from 'zod'
import type { ImageModelCapabilities, ReferenceImageConstraints } from '#lib/types/index.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { createNanoGPTImage } from './nanogptImage'
import { parseModelList } from './parseModelList'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'
import { specToPixels, formatImageSize, pickSize, specToAspectRatio } from '#lib/utils/image.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'

const DEFAULT_BASE_URL = 'https://api.nano-gpt.com/api/v1'
const DISCOVERY_SERVICE_ID = 'nanogpt-image-models'

// Keeps `w:h` ratios; the catalogue also lists values like `auto` and `match_input_image`.
const ASPECT_RATIO = /^\d+(\.\d+)?:\d+(\.\d+)?$/

const optionalString = z.string().optional().catch(undefined)
const optionalNumber = z.number().optional().catch(undefined)
const modalities = z.array(z.string()).optional().catch(undefined)

// The catalogue lists these as flat arrays; its docs describe `{ type: 'enum', values }`.
const stringList = z
  .union([
    z.array(z.string()),
    z.object({ values: z.array(z.string()) }).transform((o) => o.values),
  ])
  .optional()
  .catch(undefined)

const constraintSide = z
  .object({
    min_width: optionalNumber,
    min_height: optionalNumber,
    max_width: optionalNumber,
    max_height: optionalNumber,
    max_bytes: optionalNumber,
    formats: z.array(z.string()).optional().catch(undefined),
  })
  .optional()
  .catch(undefined)

const imageConstraints = z
  .object({ max_items: optionalNumber, route: constraintSide, provider: constraintSide })
  .optional()
  .catch(undefined)

const supportedParameters = z
  .object({
    resolutions: stringList,
    resolution: stringList,
    aspect_ratio: stringList,
    max_input_images: optionalNumber,
    input_image_constraints: imageConstraints,
    input_references: z
      .object({ min: optionalNumber, max: optionalNumber })
      .optional()
      .catch(undefined),
  })
  .catch({})

const featureFlags = z
  .object({ image_to_image: z.boolean().optional().catch(undefined) })
  .optional()
  .catch(undefined)

const NanoGptModel = z.object({
  id: z.string(),
  name: optionalString,
  description: optionalString,
  architecture: z
    .object({ input_modalities: modalities, output_modalities: modalities })
    .optional()
    .catch(undefined),
  capabilities: featureFlags,
  supported_parameters: supportedParameters,
})

const ModelEndpoints = z.object({
  id: z.string(),
  endpoints: z.array(
    z.object({
      supported_parameters: supportedParameters,
      input_reference_constraints: imageConstraints,
      capabilities: featureFlags,
    }),
  ),
})

type NanoGptModel = z.output<typeof NanoGptModel>
type ModelFacts = Pick<NanoGptModel, 'architecture' | 'capabilities' | 'supported_parameters'>
type ImageConstraints = z.output<typeof imageConstraints>

const nonEmpty = (list?: string[]) => (list?.length ? list : undefined)

function boundOf(values: (number | undefined)[], pick: (...n: number[]) => number) {
  const present = values.filter((v): v is number => v !== undefined)
  return present.length ? pick(...present) : undefined
}

/** The tighter of NanoGPT's route limits and the provider's; a side that lists nothing does not restrict. */
function toReferenceConstraints(
  constraints: ImageConstraints,
): ReferenceImageConstraints | undefined {
  const sides = [constraints?.route, constraints?.provider].filter((side) => !!side)
  if (!sides.length) return undefined

  const formatLists = sides.flatMap((side) => (side.formats?.length ? [side.formats] : []))
  const formats = formatLists.reduce<string[] | undefined>(
    (common, list) => (common ? common.filter((f) => list.includes(f)) : list),
    undefined,
  )

  const result: ReferenceImageConstraints = {
    maxBytes: boundOf(
      sides.map((side) => side.max_bytes),
      Math.min,
    ),
    minSide: boundOf(
      sides.flatMap((side) => [side.min_width, side.min_height]),
      Math.max,
    ),
    maxSide: boundOf(
      sides.flatMap((side) => [side.max_width, side.max_height]),
      Math.min,
    ),
    mimeTypes: formats?.length ? formats.map((f) => `image/${f.toLowerCase()}`) : undefined,
  }
  return Object.values(result).some((v) => v !== undefined) ? result : undefined
}

function toCapabilities({
  architecture,
  capabilities: flags,
  supported_parameters: params,
}: ModelFacts): ImageModelCapabilities {
  const maxReferenceImages =
    params.max_input_images ??
    params.input_references?.max ??
    params.input_image_constraints?.max_items

  // A text-to-image model that lists a reference count still takes references.
  const supportsImg2Img = (maxReferenceImages ?? 0) > 0 ? true : flags?.image_to_image

  // Only a model that takes images and no text is reference-only; an unreadable
  // `architecture` must not mark a text-to-image model as one.
  const inputs = architecture?.input_modalities
  const editsOnly = !!inputs?.includes('image') && !inputs.includes('text')
  const requiresReferenceImage = editsOnly || (params.input_references?.min ?? 0) >= 1

  return {
    supportsImg2Img,
    maxReferenceImages,
    requiresReferenceImage: requiresReferenceImage ? true : undefined,
    referenceConstraints: toReferenceConstraints(params.input_image_constraints),
    supportedResolutions: nonEmpty(params.resolutions) ?? nonEmpty(params.resolution),
    supportedAspectRatios: nonEmpty(params.aspect_ratio?.filter((v) => ASPECT_RATIO.test(v))),
  }
}

function toModelInfo(m: NanoGptModel): ImageModelInfo {
  return {
    id: m.id,
    name: m.name || m.id,
    description: m.description,
    inputModalities: m.architecture?.input_modalities,
    outputModalities: m.architecture?.output_modalities,
    ...toCapabilities(m),
  }
}

export function createNanoGPTProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl) || DEFAULT_BASE_URL
  const nanogpt = createNanoGPTImage({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('nanogpt-image'),
  })

  // Discovery works without a key; it is sent when set in case NanoGPT starts to vary the list by account.
  const discoveryHeaders = (apiKey?: string) => {
    const key = apiKey || config.apiKey
    return key ? { Authorization: `Bearer ${key}` } : undefined
  }

  async function fetchModels(apiKey?: string): Promise<NanoGptModel[]> {
    const response = await imageGetFetch(`${baseUrl}/images/models`, discoveryHeaders(apiKey), {
      serviceId: DISCOVERY_SERVICE_ID,
    })
    return parseModelList(await response.json(), NanoGptModel)
  }

  return {
    id: 'nanogpt',
    name: 'NanoGPT',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, modelInfo, referenceImages, signal } = options

      const ratios = modelInfo?.supportedAspectRatios

      return generateSdkImage({
        model: nanogpt.imageModel(model),
        prompt,
        referenceImages,
        aspectRatio: ratios?.length
          ? (specToAspectRatio(spec, ratios) as `${number}:${number}`)
          : undefined,
        providerOptions: {
          nanogpt: {
            resolution:
              pickSize(spec, modelInfo?.supportedResolutions) ??
              formatImageSize(specToPixels(spec)),
          },
        },
        signal,
      })
    },

    async listModels(apiKey?: string): Promise<ImageModelInfo[]> {
      return (await fetchModels(apiKey)).map(toModelInfo)
    },

    // The list omits some ids that `/images` still serves, under a shorter name; those resolve here.
    async getModelCapabilities(model: string): Promise<ImageModelCapabilities | undefined> {
      const models = await fetchModels()
      const listed = models.find((m) => m.id === model)
      if (listed) return toCapabilities(listed)

      const path = model.split('/').map(encodeURIComponent).join('/')
      const response = await imageGetFetch(
        `${baseUrl}/images/models/${path}/endpoints`,
        discoveryHeaders(),
        { serviceId: DISCOVERY_SERVICE_ID, allowStatuses: [404] },
      )
      if (response.status === 404) {
        await response.body?.cancel()
        return undefined
      }

      const reply = ModelEndpoints.safeParse(await response.json())
      if (!reply.success) throw new Error(`NanoGPT sent an unreadable endpoint reply for ${model}`)
      const [endpoint] = reply.data.endpoints
      if (!endpoint) return undefined

      // The list entry also knows the model's input modalities, which an endpoint does not.
      const canonical = models.find((m) => m.id === reply.data.id)
      if (canonical) return toCapabilities(canonical)
      return toCapabilities({
        capabilities: endpoint.capabilities,
        supported_parameters: {
          ...endpoint.supported_parameters,
          input_image_constraints:
            endpoint.supported_parameters.input_image_constraints ??
            endpoint.input_reference_constraints,
        },
      })
    },
  }
}
