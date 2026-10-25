import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('#lib/services/discovery/utils.ts', () => ({ corsFetch: vi.fn() }))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { OpenAICompatibleTTSProvider, type TTSSettings } from './TTSService'

const fetchMock = vi.fn()

const provider = (endpoint: string) =>
  new OpenAICompatibleTTSProvider({
    endpoint,
    apiKey: 'k',
    model: 'tts-1',
    voice: 'alloy',
  } as TTSSettings)

const voicesUrl = () => fetchMock.mock.calls[0][0] as string

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('OpenAI compatible TTS endpoint', () => {
  it('builds the endpoint from the normalized base URL', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('https://normalized.test/v1')

    await provider(' https://raw.test/v1// ').getAvailableVoices()

    expect(normalizeBaseUrl).toHaveBeenCalledWith(' https://raw.test/v1// ')
    expect(voicesUrl()).toBe('https://normalized.test/v1/models')
  })

  it('falls back to OpenRouter when the endpoint normalizes to nothing', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('')

    await provider('   ').getAvailableVoices()

    expect(voicesUrl()).toBe('https://openrouter.ai/api/v1/models')
  })

  it.each(['https://host.test/v1', 'https://host.test/v1/audio/speech'])(
    'lists voices from the base of %s',
    async (endpoint) => {
      await provider(endpoint).getAvailableVoices()
      expect(voicesUrl()).toBe('https://host.test/v1/models')
    },
  )
})
