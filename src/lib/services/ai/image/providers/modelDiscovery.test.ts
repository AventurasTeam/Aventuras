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
  ['NanoGPT', () => createNanoGPTProvider({ apiKey: 'k' }), { data: [] }],
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
      await expect(create().listModels()).rejects.toThrow('boom')
    })

    it('rejects on a network error', async () => {
      vi.mocked(imageGetFetch).mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(create().listModels()).rejects.toThrow('Failed to fetch')
    })

    it('returns an empty list, not a substitute, when nothing matches', async () => {
      vi.mocked(imageGetFetch).mockResolvedValue(reply(emptyBody))
      expect(await create().listModels()).toEqual([])
    })

    it('rejects a reply that is not a list, rather than listing nothing', async () => {
      vi.mocked(imageGetFetch).mockResolvedValue(reply('<html>not the API</html>'))
      await expect(create().listModels()).rejects.toThrow(/did not return a (model )?list/)
    })

    it('forwards the abort signal to its request', async () => {
      vi.mocked(imageGetFetch).mockResolvedValue(reply(emptyBody))
      const { signal } = new AbortController()

      await create().listModels(signal)

      const calls = vi.mocked(imageGetFetch).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      for (const [, , options] of calls) expect(options?.signal).toBe(signal)
    })
  })

  it('rejects when a response body is not JSON', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response)
    await expect(createOpenRouterProvider({ apiKey: 'k' }).listModels()).rejects.toThrow(
      'Unexpected token',
    )
  })

  it('rejects A1111 entries that name no model, rather than listing blank ones', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(reply([{ filename: 'x' }]))
    await expect(createA1111Provider({ apiKey: '' }).listModels()).rejects.toThrow(
      'no readable entries',
    )
  })

  it('forwards the abort signal to both A1111 sampler requests', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(reply([]))
    const { signal } = new AbortController()

    await createA1111Provider({ apiKey: '' }).getSamplerInfo!(signal)

    const calls = vi.mocked(imageGetFetch).mock.calls
    expect(calls).toHaveLength(2)
    for (const [, , options] of calls) expect(options?.signal).toBe(signal)
  })

  describe('A1111 sampler info', () => {
    const missing = { ok: false, status: 404, body: null } as unknown as Response

    it('reads sampler and scheduler names', async () => {
      vi.mocked(imageGetFetch).mockImplementation(async (url) =>
        String(url).endsWith('/samplers')
          ? reply([{ name: 'Euler a' }, { name: 'DPM++ 2M' }])
          : reply([{ name: 'karras' }]),
      )
      expect(await createA1111Provider({ apiKey: '' }).getSamplerInfo!()).toEqual({
        samplers: ['Euler a', 'DPM++ 2M'],
        schedulers: ['karras'],
      })
    })

    it('keeps the samplers and names the minimum version when there is no schedulers route', async () => {
      vi.mocked(imageGetFetch).mockImplementation(async (url, _headers, options) =>
        String(url).endsWith('/schedulers') && options?.allowStatuses?.includes(404)
          ? missing
          : reply([{ name: 'Euler a' }]),
      )
      const info = await createA1111Provider({ apiKey: '' }).getSamplerInfo!()
      expect(info.samplers).toEqual(['Euler a'])
      expect(info.schedulers).toEqual([])
      expect(info.schedulersUnavailable).toContain('1.9.1')
    })

    it('rejects when the samplers request fails or the schedulers one fails otherwise', async () => {
      vi.mocked(imageGetFetch).mockImplementation(async (url) => {
        if (String(url).endsWith('/samplers')) throw new Error('Image API error 404')
        return reply([])
      })
      await expect(createA1111Provider({ apiKey: '' }).getSamplerInfo!()).rejects.toThrow('404')

      vi.mocked(imageGetFetch).mockImplementation(async (url) => {
        if (String(url).endsWith('/schedulers')) throw new Error('Image API error 500')
        return reply([])
      })
      await expect(createA1111Provider({ apiKey: '' }).getSamplerInfo!()).rejects.toThrow('500')
    })

    it('rejects a reply that is not a list', async () => {
      vi.mocked(imageGetFetch).mockResolvedValue(reply('<html></html>'))
      await expect(createA1111Provider({ apiKey: '' }).getSamplerInfo!()).rejects.toThrow(
        'did not return a list',
      )
    })
  })

  it('makes no OpenAI request without a key', async () => {
    expect(await createOpenAIProvider({ apiKey: '' }).listModels()).toEqual([])
    expect(imageGetFetch).not.toHaveBeenCalled()
  })
})
