import { describe, expect, it, vi } from 'vitest'

import { runWizardAssist } from './assist'
import { descriptionOutputSchema } from './assist-schemas'

vi.mock('@/lib/ai', async (orig) => {
  const actual = await orig<Record<string, unknown>>()
  return {
    ...actual,
    resolveModel: vi.fn(() => ({ ok: true, providerId: 'p', modelId: 'm', params: {} })),
    getModel: vi.fn(() => ({}) as never),
    runProviderCall: vi.fn(() => Promise.resolve({ text: '{"description":"A tale."}' })),
  }
})

const CFG = {
  providers: [],
  profiles: [],
  assignments: { 'wizard-assist': 'prof' },
  defaultProviderId: 'p',
}

describe('runWizardAssist', () => {
  it('resolves wizard-assist, calls the provider, and parses structured output', async () => {
    const res = await runWizardAssist(
      'build prompt text',
      descriptionOutputSchema,
      CFG,
      new AbortController().signal,
    )
    expect(res).toEqual({ status: 'ok', value: { description: 'A tale.' } })
  })
  it('returns not-configured when the resolver fails', async () => {
    const ai = await import('@/lib/ai')
    vi.mocked(ai.resolveModel).mockReturnValueOnce({
      ok: false,
      kind: 'no-profile-assigned',
      target: 'wizard-assist',
    })
    const res = await runWizardAssist(
      'x',
      descriptionOutputSchema,
      CFG,
      new AbortController().signal,
    )
    expect(res.status).toBe('not-configured')
  })
  it('returns failed when the call/parse ultimately fails', async () => {
    const ai = await import('@/lib/ai')
    vi.mocked(ai.runProviderCall).mockResolvedValue({ text: 'not json <<<' } as never)
    const res = await runWizardAssist(
      'x',
      descriptionOutputSchema,
      CFG,
      new AbortController().signal,
    )
    expect(res.status).toBe('failed')
  })
})
