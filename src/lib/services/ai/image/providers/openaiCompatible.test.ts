import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageFetch: vi.fn(),
  imageGetFetch: vi.fn(),
}))

import { generateOpenAICompatible } from './openaiCompatible'
import { imageFetch, imageGetFetch } from './fetchAdapter'

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

  it('trims references to maxReferences', async () => {
    await generateOpenAICompatible({ ...base, referenceImages: [PNG, JPEG], maxReferences: 1 })

    const form = sentForm()
    expect(form.getAll('image')).toHaveLength(1)
    expect(form.getAll('image[]')).toHaveLength(0)
  })

  it('stringifies extraFields into the form', async () => {
    await generateOpenAICompatible({
      ...base,
      referenceImages: [PNG],
      extraFields: { safe: false },
    })
    expect(sentForm().get('safe')).toBe('false')
  })

  it('fetches a url result without Authorization and returns base64', async () => {
    vi.mocked(imageFetch).mockResolvedValue(
      jsonResponse({ data: [{ url: 'https://cdn.test/a.png', revised_prompt: 'rp' }] }),
    )
    vi.mocked(imageGetFetch).mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response)

    const result = await generateOpenAICompatible(base)

    expect(vi.mocked(imageGetFetch).mock.calls[0][0]).toBe('https://cdn.test/a.png')
    expect(vi.mocked(imageGetFetch).mock.calls[0][1]).toBeUndefined()
    expect(result).toEqual({ base64: btoa('\x01\x02\x03'), revisedPrompt: 'rp' })
  })

  it('throws when the response carries no image', async () => {
    vi.mocked(imageFetch).mockResolvedValue(jsonResponse({ data: [] }))
    await expect(generateOpenAICompatible(base)).rejects.toThrow('No image data')
  })
})
