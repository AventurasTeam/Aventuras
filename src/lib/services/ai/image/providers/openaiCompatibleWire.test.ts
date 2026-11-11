import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real SDK against a recording fetch: what leaves the app, not what is handed to the SDK.
const sent = vi.hoisted(() => ({ bodies: [] as BodyInit[] }))

vi.mock('./sdkImage', async () => {
  const { generateImage } = await import('ai')
  return {
    createImageSdkFetch: () => async (_url: unknown, init?: RequestInit) => {
      sent.bodies.push(init!.body!)
      return new Response(JSON.stringify({ data: [{ b64_json: 'AAA' }] }), {
        headers: { 'content-type': 'application/json' },
      })
    },
    generateSdkImage: async (options: {
      model: Parameters<typeof generateImage>[0]['model']
      prompt: string
      referenceImages?: string[]
      size?: `${number}x${number}`
      providerOptions?: Parameters<typeof generateImage>[0]['providerOptions']
    }) => {
      const { model, prompt, referenceImages, size, providerOptions } = options
      const result = await generateImage({
        model,
        prompt: referenceImages?.length ? { text: prompt, images: referenceImages } : prompt,
        size,
        providerOptions,
        maxRetries: 0,
      })
      return { base64: result.image.base64 }
    },
  }
})

import { generateOpenAICompatibleImage } from './openaiCompatible'

const PNG = 'iVBORw0KGgo='

const generate = (model: string, referenceImages?: string[]) =>
  generateOpenAICompatibleImage({
    baseUrl: 'https://proxy.test/v1',
    serviceId: 'svc-image',
    model,
    prompt: 'a castle',
    size: '1024x1024',
    referenceImages,
  })

beforeEach(() => {
  sent.bodies.length = 0
})

describe('the model in a request', () => {
  it('is sent when the profile names one', async () => {
    await generate('flux-dev')

    expect(JSON.parse(sent.bodies[0] as string)).toMatchObject({ model: 'flux-dev' })
  })

  it('is left out of a generation when the profile names none', async () => {
    await generate('')

    const body = JSON.parse(sent.bodies[0] as string)
    expect(body).not.toHaveProperty('model')
    expect(body).toMatchObject({ prompt: 'a castle', response_format: 'b64_json' })
  })

  it('is left out of an edit when the profile names none', async () => {
    await generate('', [PNG])

    const form = sent.bodies[0] as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.has('model')).toBe(false)
    expect(form.get('prompt')).toBe('a castle')
  })

  it('is sent with an edit when the profile names one', async () => {
    await generate('flux-dev', [PNG])

    expect((sent.bodies[0] as FormData).get('model')).toBe('flux-dev')
  })
})
