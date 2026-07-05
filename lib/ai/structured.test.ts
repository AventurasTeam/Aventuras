import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { generateStructured, parseStructured } from './structured'

// Only the model-resolution + provider I/O are faked; the real callWithRetry
// and parseStructured run, exercising the retry + structured-parse path.
vi.mock('./resolve-model', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveModel: vi.fn(() => ({ ok: true, providerId: 'p', modelId: 'm', params: {} })),
}))
vi.mock('./model', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getModel: vi.fn(() => ({}) as never),
}))
vi.mock('./transport/provider-call', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runProviderCall: vi.fn(() => Promise.resolve({ text: '{"description":"A tale."}' })),
}))

const schema = z.object({ description: z.string() })

const CFG = {
  providers: [],
  profiles: [],
  assignments: { 'wizard-assist': 'prof' },
  defaultProviderId: 'p',
}

describe('parseStructured', () => {
  it('parses strict JSON', () => {
    expect(parseStructured('{"description":"Hi"}', schema)).toEqual({ description: 'Hi' })
  })
  it('recovers via jsonrepair (trailing comma)', () => {
    expect(parseStructured('{"description":"Hi",}', schema).description).toBe('Hi')
  })
  it('recovers via jsonrepair (markdown fence)', () => {
    expect(parseStructured('```json\n{"description":"Hi"}\n```', schema).description).toBe('Hi')
  })
  it('throws on malformed-beyond-repair output', () => {
    expect(() => parseStructured('not json at all <<<', schema)).toThrow()
  })
  it('throws when valid JSON fails schema validation', () => {
    expect(() => parseStructured('{"wrong":1}', schema)).toThrow()
  })
})

describe('generateStructured', () => {
  it('resolves the target, calls the provider, and parses structured output', async () => {
    const res = await generateStructured(
      'wizard-assist',
      'build prompt text',
      schema,
      CFG,
      new AbortController().signal,
    )
    expect(res).toEqual({ status: 'ok', value: { description: 'A tale.' } })
  })
  it('returns not-configured when the resolver fails', async () => {
    const { resolveModel } = await import('./resolve-model')
    vi.mocked(resolveModel).mockReturnValueOnce({
      ok: false,
      kind: 'no-profile-assigned',
      target: 'wizard-assist',
    })
    const res = await generateStructured(
      'wizard-assist',
      'x',
      schema,
      CFG,
      new AbortController().signal,
    )
    expect(res.status).toBe('not-configured')
  })
  it('returns failed when the call/parse ultimately fails', async () => {
    const { runProviderCall } = await import('./transport/provider-call')
    vi.mocked(runProviderCall).mockResolvedValue({ text: 'not json <<<' } as never)
    const res = await generateStructured(
      'wizard-assist',
      'x',
      schema,
      CFG,
      new AbortController().signal,
    )
    expect(res.status).toBe('failed')
  })
})
