/**
 * A1111 / Stable Diffusion WebUI Image Provider
 *
 * Compatible with AUTOMATIC1111, Forge, and KoboldCPP's SD image generation API.
 * - txt2img: POST /sdapi/v1/txt2img
 * - Models:  GET  /sdapi/v1/sd-models
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
  ComfySamplerInfo,
} from './types'
import { imageFetch, imageGetFetch } from './fetchAdapter'

const DEFAULT_BASE_URL = 'http://localhost:7860'

export function createA1111Provider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl?.trim().replace(/\/$/, '') || DEFAULT_BASE_URL

  return {
    id: 'a1111',
    name: 'A1111 / SD WebUI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, size, signal, providerOptions } = options
      const [width, height] = (size || '512x512').split('x').map(Number)

      const opts = providerOptions ?? config.providerOptions ?? {}
      const steps = Number(opts.steps) || 20
      const cfgScale = Number(opts.cfg) || 7
      const sampler = (opts.sampler as string) || 'Euler a'
      const scheduler = (opts.scheduler as string) || undefined
      const negativePrompt = (opts.negativePrompt as string) || ''

      const body: Record<string, unknown> = {
        prompt,
        negative_prompt: negativePrompt,
        width: width || 512,
        height: height || 512,
        steps,
        cfg_scale: cfgScale,
        sampler_name: sampler,
        batch_size: 1,
        n_iter: 1,
        seed: -1,
      }

      if (scheduler) body.scheduler = scheduler

      if (model) {
        body.override_settings = { sd_model_checkpoint: model }
        body.override_settings_restore_afterwards = true
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

      const response = await imageFetch({
        url: `${baseUrl}/sdapi/v1/txt2img`,
        headers,
        body: JSON.stringify(body),
        signal,
        serviceId: 'a1111-image',
      })

      const data = await response.json()
      const base64 = data?.images?.[0]
      if (!base64) throw new Error('No image data in A1111 response')

      return { base64 }
    },

    async listModels(apiKey: string): Promise<ImageModelInfo[]> {
      const headers: Record<string, string> = {}
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`

      try {
        const response = await imageGetFetch(`${baseUrl}/sdapi/v1/sd-models`, headers, {
          serviceId: 'a1111-models',
        })
        const data: { title?: string; model_name?: string; name?: string }[] = await response.json()

        return (Array.isArray(data) ? data : []).map((m) => ({
          id: m.title || m.model_name || m.name || '',
          name: m.title || m.model_name || m.name || '',
          supportsSizes: [],
          supportsImg2Img: false,
        }))
      } catch {
        return []
      }
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
