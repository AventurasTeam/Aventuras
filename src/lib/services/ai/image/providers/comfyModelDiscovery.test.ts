import { describe, it, expect, vi, beforeEach } from 'vitest'

const sdk = vi.hoisted(() => ({ getCheckpoints: vi.fn() }))

vi.mock('@saintno/comfyui-sdk', () => ({
  ComfyApi: class {
    getCheckpoints = sdk.getCheckpoints
    on = vi.fn()
    addEventListener = vi.fn()
    init = vi.fn()
    destroy = vi.fn()
  },
  PromptBuilder: class {},
  CallWrapper: class {},
}))
vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('#lib/utils/http.ts', () => ({ httpFetch: vi.fn() }))
vi.mock('./tauriWebSocket', () => ({ TauriWebSocket: class {} }))

import { imageGetFetch } from './fetchAdapter'
import { createComfyProvider } from './comfy'

const reply = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

describe('ComfyUI model discovery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects when the checkpoint list cannot be fetched', async () => {
    sdk.getCheckpoints.mockRejectedValue(new Error('connect ECONNREFUSED'))
    vi.mocked(imageGetFetch).mockResolvedValue(reply([]))
    await expect(createComfyProvider({ apiKey: '' }).listModels()).rejects.toThrow('ECONNREFUSED')
  })

  it('treats the optional lists as empty when they fail', async () => {
    sdk.getCheckpoints.mockResolvedValue(['sd15.safetensors'])
    vi.mocked(imageGetFetch).mockRejectedValue(new Error('Image API error 404'))
    const models = await createComfyProvider({ apiKey: '' }).listModels()
    expect(models.map((m) => m.id)).toEqual(['checkpoint:sd15.safetensors'])
  })

  it('returns an empty list when the server has no models', async () => {
    sdk.getCheckpoints.mockResolvedValue([])
    vi.mocked(imageGetFetch).mockResolvedValue(reply([]))
    expect(await createComfyProvider({ apiKey: '' }).listModels()).toEqual([])
  })
})
