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

import { createA1111Provider } from './a1111'
import type { ImageGenerateOptions } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'dreamshaper_8.safetensors',
  prompt: 'a castle',
  spec: { orientation: 'landscape', size: 'medium' },
  ...over,
})

function sentRequest() {
  const [, init] = sdkFetch.mock.calls[0] as [string, RequestInit]
  return {
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

  it('maps the provider options onto the request', async () => {
    await createA1111Provider({ apiKey: '' }).generate(
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

    expect(sentRequest().body).toMatchObject({
      prompt: 'a castle',
      negative_prompt: 'blurry',
      width: 1536,
      height: 864,
      steps: 30,
      cfg_scale: 6.5,
      sampler_name: 'DPM++ 2M',
      scheduler: 'Karras',
    })
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

  it('sends the key', async () => {
    await createA1111Provider({ apiKey: 'k' }).generate(options())
    expect(sentRequest().headers.get('Authorization')).toBe('Bearer k')
  })
})
