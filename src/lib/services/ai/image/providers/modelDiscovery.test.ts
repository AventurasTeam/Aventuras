import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('./sdkImage', () => ({ createImageSdkFetch: vi.fn(), generateSdkImage: vi.fn() }))

import { imageGetFetch } from './fetchAdapter'
import { createNanoGPTProvider } from './nanogpt'
import { createOpenRouterProvider } from './openrouter'
import { createPollinationsProvider } from './pollinations'
import { createOpenAIProvider } from './openai'
import { createA1111Provider } from './a1111'
import type { ImageProvider } from './types'

const reply = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

// A successful fetch that lists no image model, per adapter.
const EMPTY: [string, () => ImageProvider, unknown][] = [
  ['NanoGPT', () => createNanoGPTProvider({ apiKey: 'k' }), { models: { image: {} } }],
  ['OpenRouter', () => createOpenRouterProvider({ apiKey: 'k' }), { data: [] }],
  ['Pollinations', () => createPollinationsProvider({ apiKey: 'k' }), []],
  ['OpenAI', () => createOpenAIProvider({ apiKey: 'k' }), { data: [{ id: 'gpt-4o' }] }],
  ['A1111', () => createA1111Provider({ apiKey: '' }), []],
]

describe('model discovery', () => {
  beforeEach(() => vi.clearAllMocks())

  describe.each(EMPTY)('%s', (_name, create, emptyBody) => {
    it('rejects when the request fails', async () => {
      vi.mocked(imageGetFetch).mockRejectedValue(new Error('Image API error 500: boom'))
      await expect(create().listModels('k')).rejects.toThrow('boom')
    })

    it('rejects on a network error', async () => {
      vi.mocked(imageGetFetch).mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(create().listModels('k')).rejects.toThrow('Failed to fetch')
    })

    it('returns an empty list, not a substitute, when nothing matches', async () => {
      vi.mocked(imageGetFetch).mockResolvedValue(reply(emptyBody))
      expect(await create().listModels('k')).toEqual([])
    })
  })

  it('rejects when Pollinations returns something other than a list', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(reply({ error: 'nope' }))
    await expect(createPollinationsProvider({ apiKey: 'k' }).listModels('k')).rejects.toThrow(
      'unexpected model list',
    )
  })

  it('rejects when a response body is not JSON', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response)
    await expect(createOpenRouterProvider({ apiKey: 'k' }).listModels('k')).rejects.toThrow(
      'Unexpected token',
    )
  })

  it('makes no OpenAI request without a key', async () => {
    expect(await createOpenAIProvider({ apiKey: '' }).listModels('')).toEqual([])
    expect(imageGetFetch).not.toHaveBeenCalled()
  })

  it('lists OpenRouter models through the Tauri transport', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      reply({
        data: [
          {
            id: 'google/gemini-2.5-flash-image',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
          },
          { id: 'openai/gpt-5', architecture: { output_modalities: ['text'] } },
        ],
      }),
    )
    const models = await createOpenRouterProvider({ apiKey: 'k' }).listModels('k')
    expect(models.map((m) => m.id)).toEqual(['google/gemini-2.5-flash-image'])
    expect(imageGetFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      { Authorization: 'Bearer k' },
      expect.anything(),
    )
  })
})
