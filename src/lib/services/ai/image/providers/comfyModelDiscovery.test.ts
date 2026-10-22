import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(),
}))

import { imageGetFetch } from './fetchAdapter'
import { createComfyProvider } from './comfy'

const reply = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

// Answers /models/<type> from `lists`; a type left out fails like a server without that folder.
function serveModels(lists: Record<string, string[]>) {
  vi.mocked(imageGetFetch).mockImplementation(async (url) => {
    const type = String(url).split('/models/')[1]
    if (!(type in lists)) throw new Error('Image API error 404')
    return reply(lists[type])
  })
}

describe('ComfyUI model discovery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects when the checkpoint list cannot be fetched', async () => {
    vi.mocked(imageGetFetch).mockRejectedValue(new Error('connect ECONNREFUSED'))
    await expect(createComfyProvider({ apiKey: '' }).listModels()).rejects.toThrow('ECONNREFUSED')
  })

  it('treats the optional lists as empty when they fail', async () => {
    serveModels({ checkpoints: ['sd15.safetensors'] })
    const models = await createComfyProvider({ apiKey: '' }).listModels()
    expect(models.map((m) => m.id)).toEqual(['checkpoint:sd15.safetensors'])
  })

  it('returns an empty list when the server has no models', async () => {
    serveModels({ checkpoints: [], diffusion_models: [], text_encoders: [], vae: [] })
    expect(await createComfyProvider({ apiKey: '' }).listModels()).toEqual([])
  })

  it('prefixes checkpoints and diffusion models by source', async () => {
    serveModels({ checkpoints: ['a.safetensors'], diffusion_models: ['flux.safetensors'] })
    const models = await createComfyProvider({ apiKey: '' }).listModels()
    expect(models.map((m) => m.id)).toEqual(['checkpoint:a.safetensors', 'unet:flux.safetensors'])
  })

  it('lists LoRAs, and none when the folder cannot be read', async () => {
    serveModels({ loras: ['detail.safetensors'] })
    expect(await createComfyProvider({ apiKey: '' }).listLoras!()).toEqual(['detail.safetensors'])
    serveModels({})
    expect(await createComfyProvider({ apiKey: '' }).listLoras!()).toEqual([])
  })

  it('reads samplers and schedulers from the KSampler node', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      reply({
        KSampler: {
          input: {
            required: {
              sampler_name: [['euler', 'dpmpp_2m']],
              scheduler: [['karras', 'simple']],
            },
          },
        },
      }),
    )
    const info = await createComfyProvider({ apiKey: '' }).getSamplerInfo!()
    expect(info).toEqual({ samplers: ['euler', 'dpmpp_2m'], schedulers: ['karras', 'simple'] })
    expect(vi.mocked(imageGetFetch).mock.calls[0][0]).toBe(
      'http://localhost:8188/object_info/KSampler',
    )
  })

  it('reads the options of an input in the COMBO form', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      reply({
        KSampler: {
          input: {
            required: {
              sampler_name: ['COMBO', { options: ['euler', 'dpmpp_2m'] }],
              scheduler: ['COMBO', { options: ['karras', 'simple', 7] }],
            },
          },
        },
      }),
    )
    const info = await createComfyProvider({ apiKey: '' }).getSamplerInfo!()
    expect(info).toEqual({ samplers: ['euler', 'dpmpp_2m'], schedulers: ['karras', 'simple'] })
  })

  it('finds no choices in an input of another type', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      reply({
        KSampler: {
          input: { required: { sampler_name: ['COMBO'], scheduler: ['STRING', { default: 'x' }] } },
        },
      }),
    )
    const info = await createComfyProvider({ apiKey: '' }).getSamplerInfo!()
    expect(info).toEqual({ samplers: [], schedulers: [] })
  })
})
