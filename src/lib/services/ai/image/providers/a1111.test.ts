import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

const sdkFetch = vi.hoisted(() => vi.fn())
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(() => sdkFetch),
}))

import { createSdkFetch } from '#lib/services/ai/sdk/providers/sdkFetch.ts'
import { createA1111Provider } from './a1111'
import type { ImageGenerateOptions } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'dreamshaper_8.safetensors',
  prompt: 'a castle',
  spec: { orientation: 'landscape', size: 'medium' },
  ...over,
})

function sentRequest() {
  const [url, init] = sdkFetch.mock.calls[0] as [string, RequestInit]
  return {
    url,
    headers: new Headers(init.headers),
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  }
}

describe('A1111 adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdkFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ images: ['RESULT'] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    )
  })

  it('labels its fetch a1111-image', () => {
    createA1111Provider({ apiKey: '' })
    expect(createSdkFetch).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'a1111-image' }),
    )
  })

  it('sends the same request body as the hand-written adapter did', async () => {
    const result = await createA1111Provider({ apiKey: '' }).generate(
      options({
        providerOptions: {
          steps: 30,
          cfg: 6.5,
          sampler: 'DPM++ 2M',
          scheduler: 'Karras',
          negativePrompt: 'blurry',
        },
      }),
    )

    const { url, headers, body } = sentRequest()
    expect(url).toBe('http://localhost:7860/sdapi/v1/txt2img')
    expect(headers.has('Authorization')).toBe(false)
    expect(body).toEqual({
      prompt: 'a castle',
      negative_prompt: 'blurry',
      width: 1536,
      height: 864,
      steps: 30,
      cfg_scale: 6.5,
      sampler_name: 'DPM++ 2M',
      scheduler: 'Karras',
      batch_size: 1,
      n_iter: 1,
      seed: -1,
      override_settings: { sd_model_checkpoint: 'dreamshaper_8.safetensors' },
      override_settings_restore_afterwards: true,
    })
    expect(result).toEqual({ base64: 'RESULT' })
  })

  it('defaults the sampler options and leaves out the scheduler and an empty model', async () => {
    await createA1111Provider({ apiKey: '' }).generate(
      options({ model: '', spec: { orientation: 'square', size: 'tiny' } }),
    )

    expect(sentRequest().body).toEqual({
      prompt: 'a castle',
      negative_prompt: '',
      width: 512,
      height: 512,
      steps: 20,
      cfg_scale: 7,
      sampler_name: 'Euler a',
      batch_size: 1,
      n_iter: 1,
      seed: -1,
    })
  })

  it("falls back to the profile's provider options", async () => {
    await createA1111Provider({ apiKey: '', providerOptions: { steps: 12 } }).generate(options())
    expect(sentRequest().body.steps).toBe(12)
  })

  it.each(['http://192.168.1.5:7860', 'http://192.168.1.5:7860/'])(
    'keeps the configured base URL %s and sends the key',
    async (baseUrl) => {
      await createA1111Provider({ apiKey: 'k', baseUrl }).generate(options())
      const { url, headers } = sentRequest()
      expect(url).toBe('http://192.168.1.5:7860/sdapi/v1/txt2img')
      expect(headers.get('Authorization')).toBe('Bearer k')
    },
  )
})
