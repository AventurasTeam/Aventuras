/**
 * A1111 / Stable Diffusion WebUI Image Provider
 *
 * Compatible with AUTOMATIC1111, Forge, and KoboldCPP's SD image generation API.
 * - txt2img: POST /sdapi/v1/txt2img
 * - Models:  GET  /sdapi/v1/sd-models
 */

import * as z from 'zod'
import { formatImageSize, specToPixels } from '#lib/utils/image.ts'
import { endpoint } from '#lib/utils/url.ts'
import { resolveBaseUrl } from './baseUrls'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
  ComfySamplerInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { imageGetFetchOptional } from './discoveryFetch'
import { optionalString } from './modelCatalogue'
import { parseModelList } from './parseModelList'
import { createA1111Image } from './a1111Image'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

const SdModel = z
  .object({
    title: optionalString,
    model_name: optionalString,
    name: optionalString,
  })
  .refine((m) => !!(m.title || m.model_name || m.name))
const NamedEntry = z.object({ name: z.string() })

/** The first release with `/sdapi/v1/schedulers`. */
export const MIN_A1111_SCHEDULERS_VERSION = '1.9.1'

const SCHEDULERS_UNAVAILABLE = `This server has no /sdapi/v1/schedulers. Listing schedulers needs A1111 ${MIN_A1111_SCHEDULERS_VERSION} or newer.`

/** A1111 sends references only when the profile opts in: sd.cpp and KoboldCpp read `extra_images`. */
export const a1111ReferenceLimit = (
  providerOptions: Record<string, unknown> | undefined,
): number => (providerOptions?.takesReferences === true ? Infinity : 0)

export function createA1111Provider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = resolveBaseUrl('a1111', config.baseUrl)
  const a1111 = createA1111Image({
    baseURL: baseUrl,
    apiKey: config.apiKey,
    fetch: createImageSdkFetch('a1111-image'),
  })

  return {
    id: 'a1111',
    name: 'A1111 / SD WebUI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal, providerOptions } = options

      const opts = providerOptions ?? config.providerOptions ?? {}
      const scheduler = (opts.scheduler as string) || undefined

      return generateSdkImage({
        model: a1111.imageModel(model),
        prompt,
        referenceImages,
        size: formatImageSize(specToPixels(spec)),
        providerOptions: {
          a1111: {
            negative_prompt: (opts.negativePrompt as string) || '',
            steps: Number(opts.steps) || 20,
            cfg_scale: Number(opts.cfg) || 7,
            sampler_name: (opts.sampler as string) || 'Euler a',
            ...(scheduler && { scheduler }),
          },
        },
        signal,
      })
    },

    async listModels(apiKey: string, signal?: AbortSignal): Promise<ImageModelInfo[]> {
      const headers: Record<string, string> = {}
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`

      const response = await imageGetFetch(endpoint(baseUrl, 'sdapi/v1/sd-models'), headers, {
        serviceId: 'a1111-models',
        signal,
      })
      const entries = parseModelList(await response.json(), SdModel, 'A1111 /sdapi/v1/sd-models')

      return entries.map((m) => {
        const id = m.title || m.model_name || m.name || ''
        return { id, name: id }
      })
    },

    async getSamplerInfo(signal?: AbortSignal): Promise<ComfySamplerInfo> {
      const authHeaders: Record<string, string> | undefined = config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined

      const readNames = async (
        path: string,
        serviceId: string,
        absentStatuses?: number[],
      ): Promise<string[] | undefined> => {
        const response = await imageGetFetchOptional(
          endpoint(baseUrl, `sdapi/v1/${path}`),
          authHeaders,
          { serviceId, absentStatuses, signal },
        )
        if (!response) return undefined
        return parseModelList(await response.json(), NamedEntry, `A1111 /sdapi/v1/${path}`)
          .map((s) => s.name)
          .filter(Boolean)
      }

      const [samplers, schedulers] = await Promise.all([
        readNames('samplers', 'a1111-samplers'),
        readNames('schedulers', 'a1111-schedulers', [404]),
      ])
      return {
        samplers: samplers ?? [],
        schedulers: schedulers ?? [],
        ...(schedulers === undefined && { schedulersUnavailable: SCHEDULERS_UNAVAILABLE }),
      }
    },
  }
}
