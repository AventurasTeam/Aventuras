import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageFetch: vi.fn(),
  fetchImageBase64: vi.fn(),
}))

import { generateOpenAICompatible } from './openaiCompatible'
import { imageFetch, fetchImageBase64 } from './fetchAdapter'

const PNG = 'iVBORw0KGgo='
const JPEG = '/9j/4AAQSkZJRg=='

const jsonResponse = (body: unknown) => ({ json: async () => body }) as unknown as Response

const base = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'sk-test',
  model: 'm1',
  prompt: 'a castle',
  size: '1024x1024',
  serviceId: 'test-image',
}

function sentForm(): FormData {
  const body = vi.mocked(imageFetch).mock.calls[0][0].body
  expect(body).toBeInstanceOf(FormData)
  return body as FormData
}

describe('generateOpenAICompatible', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(imageFetch).mockResolvedValue(jsonResponse({ data: [{ b64_json: 'RESULT' }] }))
  })

  it('posts JSON to /images/generations without references', async () => {
    const result = await generateOpenAICompatible({ ...base, extraFields: { safe: false } })

    const call = vi.mocked(imageFetch).mock.calls[0][0]
    expect(call.url).toBe('https://example.test/v1/images/generations')
    expect(call.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    })
    expect(JSON.parse(call.body as string)).toEqual({
      model: 'm1',
      prompt: 'a castle',
      size: '1024x1024',
      n: 1,
      response_format: 'b64_json',
      safe: false,
    })
    expect(result.base64).toBe('RESULT')
  })

  it('omits Authorization without a key', async () => {
    await generateOpenAICompatible({ ...base, apiKey: '' })
    expect(vi.mocked(imageFetch).mock.calls[0][0].headers).toEqual({
      'Content-Type': 'application/json',
    })
  })

  it('posts multipart to /images/edits with a single `image` for one reference', async () => {
    await generateOpenAICompatible({ ...base, referenceImages: [PNG] })

    const call = vi.mocked(imageFetch).mock.calls[0][0]
    expect(call.url).toBe('https://example.test/v1/images/edits')
    expect(call.headers).toEqual({ Authorization: 'Bearer sk-test' })
    expect(call.serviceId).toBe('test-image-edit')

    const form = sentForm()
    expect(form.getAll('image')).toHaveLength(1)
    expect(form.getAll('image[]')).toHaveLength(0)
    expect(form.get('model')).toBe('m1')
    expect(form.get('n')).toBe('1')
    expect(form.get('response_format')).toBe('b64_json')
  })

  it('repeats `image[]` for several references, each with its sniffed type', async () => {
    await generateOpenAICompatible({ ...base, referenceImages: [PNG, JPEG] })

    const files = sentForm().getAll('image[]') as File[]
    expect(files.map((f) => f.type)).toEqual(['image/png', 'image/jpeg'])
    expect(files.map((f) => f.name)).toEqual(['reference-1.png', 'reference-2.jpg'])
  })

  it('stringifies extraFields into the form', async () => {
    await generateOpenAICompatible({
      ...base,
      referenceImages: [PNG],
      extraFields: { safe: false },
    })
    expect(sentForm().get('safe')).toBe('false')
  })

  it('downloads a url result and returns base64', async () => {
    vi.mocked(imageFetch).mockResolvedValue(
      jsonResponse({ data: [{ url: 'https://cdn.test/a.png', revised_prompt: 'rp' }] }),
    )
    vi.mocked(fetchImageBase64).mockResolvedValue('DOWNLOADED')

    const result = await generateOpenAICompatible(base)

    expect(fetchImageBase64).toHaveBeenCalledWith('https://cdn.test/a.png', {
      signal: undefined,
      serviceId: 'test-image',
    })
    expect(result).toEqual({ base64: 'DOWNLOADED', revisedPrompt: 'rp' })
  })

  it('throws when the response carries no image', async () => {
    vi.mocked(imageFetch).mockResolvedValue(jsonResponse({ data: [] }))
    await expect(generateOpenAICompatible(base)).rejects.toThrow('No image data in test-image')
  })

  it('names the service when the body is not JSON', async () => {
    vi.mocked(imageFetch).mockResolvedValue({
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    } as unknown as Response)
    await expect(generateOpenAICompatible(base)).rejects.toThrow('No image data in test-image')
  })
})
