/**
 * A1111 / Stable Diffusion WebUI Image Provider
 *
 * Compatible with AUTOMATIC1111, Forge, and KoboldCPP's SD image generation API.
 * - txt2img: POST /sdapi/v1/txt2img
 * - Models:  GET  /sdapi/v1/sd-models
 */

import { formatImageSize, specToPixels } from '#lib/utils/image.ts'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
  ComfySamplerInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { createA1111Image } from './a1111Image'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

const DEFAULT_BASE_URL = 'http://localhost:7860'

/** A1111 sends references only when the profile opts in: sd.cpp and KoboldCpp read `extra_images`. */
export const a1111ReferenceLimit = (
  providerOptions: Record<string, unknown> | undefined,
): number => (providerOptions?.takesReferences === true ? Infinity : 0)

export function createA1111Provider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl?.trim().replace(/\/$/, '') || DEFAULT_BASE_URL
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

    async listModels(apiKey: string): Promise<ImageModelInfo[]> {
      const headers: Record<string, string> = {}
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`

      const response = await imageGetFetch(`${baseUrl}/sdapi/v1/sd-models`, headers, {
        serviceId: 'a1111-models',
      })
      const data: { title?: string; model_name?: string; name?: string }[] = await response.json()

      return (Array.isArray(data) ? data : []).map((m) => ({
        id: m.title || m.model_name || m.name || '',
        name: m.title || m.model_name || m.name || '',
      }))
    },

    async getSamplerInfo(): Promise<ComfySamplerInfo> {
      const authHeaders: Record<string, string> | undefined = config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined

      const [samplersRes, schedulersRes] = await Promise.allSettled([
        imageGetFetch(`${baseUrl}/sdapi/v1/samplers`, authHeaders, {
          serviceId: 'a1111-samplers',
        }),
        imageGetFetch(`${baseUrl}/sdapi/v1/schedulers`, authHeaders, {
          serviceId: 'a1111-schedulers',
        }),
      ])

      const toNames = (data: unknown): string[] =>
        Array.isArray(data)
          ? (data as { name?: string }[]).map((s) => s.name ?? '').filter(Boolean)
          : []

      const samplers: string[] =
        samplersRes.status === 'fulfilled'
          ? await samplersRes.value
              .json()
              .then(toNames)
              .catch(() => [])
          : []

      const schedulers: string[] =
        schedulersRes.status === 'fulfilled'
          ? await schedulersRes.value
              .json()
              .then(toNames)
              .catch(() => [])
          : []

      return { samplers, schedulers }
    },
  }
}
