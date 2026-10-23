import { describe, expect, it } from 'vitest'

import { anthropicCacheMarkerMiddleware } from './cache-marker'

const MARK = { cacheControl: { type: 'ephemeral' } }

async function transform(params: Record<string, unknown>) {
  return anthropicCacheMarkerMiddleware().transformParams!({
    type: 'generate',
    params: params as never,
    model: {} as never,
  })
}

const user = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] })

describe('anthropicCacheMarkerMiddleware', () => {
  it('marks the last system message and nothing else', async () => {
    const out = await transform({
      prompt: [
        { role: 'system', content: 'First.' },
        { role: 'system', content: 'Second.' },
        user('Go.'),
        user('Again.'),
      ],
      temperature: 0.5,
    })

    expect(out).toEqual({
      prompt: [
        { role: 'system', content: 'First.' },
        { role: 'system', content: 'Second.', providerOptions: { anthropic: MARK } },
        user('Go.'),
        user('Again.'),
      ],
      temperature: 0.5,
    })
  })

  it("keeps the message's other provider options, anthropic ones included", async () => {
    const out = await transform({
      prompt: [
        {
          role: 'system',
          content: 'Rules.',
          providerOptions: { anthropic: { other: 1 }, openaiCompatible: { x: true } },
        },
        user('Go.'),
      ],
    })

    expect(out.prompt[0]).toEqual({
      role: 'system',
      content: 'Rules.',
      providerOptions: { anthropic: { other: 1, ...MARK }, openaiCompatible: { x: true } },
    })
  })

  it('passes a prompt with no system message through unchanged', async () => {
    const params = { prompt: [user('Go.')] }
    expect(await transform(params)).toEqual({ prompt: [user('Go.')] })
  })
})
