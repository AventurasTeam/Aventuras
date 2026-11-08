import * as z from 'zod'
import type { ImageModelCapabilities, ReferenceImageConstraints } from '#lib/types/index.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { bearerHeaders, imageDiscoveryFetch, imageGetFetchOptional } from './discoveryFetch'
import { createNanoGPTImage } from './nanogptImage'
import {
  architectureSchema,
  catalogueModelInfo,
  editsOnly,
  nonEmpty,
  optionalNumber,
  optionalString,
} from './modelCatalogue'
import { parseModelList } from './parseModelList'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'
import {
  specToPixels,
  formatImageSize,
  isAspectRatio,
  pickSize,
  specToAspectRatio,
} from '#lib/utils/image.ts'
import { endpoint } from '#lib/utils/url.ts'
import { resolveBaseUrl } from './baseUrls'
import { findListedModel } from './modelCapabilities'

const DISCOVERY_SERVICE_ID = 'nanogpt-image-models'

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
  architecture: architectureSchema,
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
  const listed =
    params.max_input_images ??
    params.input_references?.max ??
    params.input_image_constraints?.max_items

  // A text-to-image model that lists a reference count still takes references. A count of zero
  // takes none, unless `image_to_image` says otherwise: conflicting signals allow references.
  const supportsImg2Img =
    listed === undefined ? flags?.image_to_image : listed > 0 || flags?.image_to_image === true
  const maxReferenceImages = listed === 0 && supportsImg2Img ? undefined : listed

  const requiresReferenceImage =
    editsOnly(architecture?.input_modalities) || (params.input_references?.min ?? 0) >= 1

  return {
    supportsImg2Img,
    maxReferenceImages,
    requiresReferenceImage: requiresReferenceImage ? true : undefined,
    referenceConstraints: toReferenceConstraints(params.input_image_constraints),
    supportedResolutions: nonEmpty(params.resolutions) ?? nonEmpty(params.resolution),
    supportedAspectRatios: nonEmpty(params.aspect_ratio?.filter(isAspectRatio)),
  }
}

const toModelInfo = (m: NanoGptModel): ImageModelInfo => catalogueModelInfo(m, toCapabilities(m))

export function createNanoGPTProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = resolveBaseUrl('nanogpt', config.baseUrl)
  const nanogpt = createNanoGPTImage({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    fetch: createImageSdkFetch('nanogpt-image'),
  })

  // Discovery works without a key; it is sent when set in case NanoGPT starts to vary the list by account.
  const discoveryHeaders = bearerHeaders(config.apiKey)

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
        aspectRatio: ratios?.length ? specToAspectRatio(spec, ratios) : undefined,
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

    async listModels(signal?: AbortSignal): Promise<ImageModelInfo[]> {
      const response = await imageDiscoveryFetch(
        endpoint(baseUrl, 'images/models'),
        discoveryHeaders,
        {
          serviceId: DISCOVERY_SERVICE_ID,
          signal,
        },
      )
      return parseModelList(await response.json(), NanoGptModel, 'NanoGPT /images/models').map(
        toModelInfo,
      )
    },

    // The list omits some ids that `/images` still serves, under a shorter name; those resolve here.
    async getModelCapabilities(
      model: string,
      listed: ImageModelInfo[],
      signal?: AbortSignal,
    ): Promise<ImageModelCapabilities | undefined> {
      const path = model.split('/').map(encodeURIComponent).join('/')
      const response = await imageGetFetchOptional(
        endpoint(baseUrl, `images/models/${path}/endpoints`),
        discoveryHeaders,
        { serviceId: DISCOVERY_SERVICE_ID, absentStatuses: [404], signal },
      )
      if (!response) return undefined

      const reply = ModelEndpoints.safeParse(await response.json())
      if (!reply.success) throw new Error(`NanoGPT sent an unreadable endpoint reply for ${model}`)
      const [served] = reply.data.endpoints
      if (!served) return undefined

      // The list entry also knows the model's input modalities, which an endpoint does not.
      const canonical = findListedModel(listed, reply.data.id)
      if (canonical) return canonical
      return toCapabilities({
        capabilities: served.capabilities,
        supported_parameters: {
          ...served.supported_parameters,
          input_image_constraints:
            served.supported_parameters.input_image_constraints ??
            served.input_reference_constraints,
        },
      })
    },
  }
}
