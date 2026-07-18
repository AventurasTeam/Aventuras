import { describe, expect, it, vi } from 'vitest'

import { buildProviderCallOptions, streamAgentCall } from './agent-call'

// Real resolveModel + buildProviderCallOptions run; only the store-backed model
// lookup and the provider I/O are faked.
vi.mock('./model', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getModel: vi.fn(() => ({}) as never),
}))
vi.mock('./transport/provider-call', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  streamProviderCall: vi.fn(() => ({ textStream: (async function* () {})() })),
}))

const provider = {
  id: 'prov-1',
  type: 'anthropic' as const,
  displayName: 'Anthropic',
  apiKey: 'key',
  favoriteModelIds: [],
}

const CFG = {
  providers: [provider],
  profiles: [
    {
      id: 'prof-narrative',
      kind: 'narrative' as const,
      name: 'Narrative',
      modelRef: { providerId: provider.id, modelId: 'model-1' },
      temperature: 0.7,
      maxOutput: 2048,
      thinking: 1024,
      timeout: 45,
    },
  ],
  assignments: {},
  defaultProviderId: provider.id,
}

describe('buildProviderCallOptions', () => {
  it('maps every profile parameter to its SDK option (anthropic)', () => {
    expect(
      buildProviderCallOptions(
        { temperature: 0.7, maxOutput: 2048, thinking: 1024, timeout: 45 },
        'anthropic',
      ),
    ).toEqual({
      temperature: 0.7,
      maxOutputTokens: 2048,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } },
      timeout: { totalMs: 45_000 },
    })
  })

  it('maps thinking 0 to an explicit disable', () => {
    expect(buildProviderCallOptions({ thinking: 0 }, 'anthropic')).toEqual({
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } },
    })
  })

  it('drops thinking for non-anthropic providers', () => {
    expect(buildProviderCallOptions({ thinking: 1024 }, 'openai-compatible')).toEqual({})
  })

  it('maps an empty params object to no options', () => {
    expect(buildProviderCallOptions({}, 'anthropic')).toEqual({})
  })
})

describe('streamAgentCall', () => {
  it('resolves the target and passes prompt + mapped options to the stream call', async () => {
    const { streamProviderCall } = await import('./transport/provider-call')
    const onError = () => {}
    const signal = new AbortController().signal

    const result = streamAgentCall('narrative', {
      prompt: 'P',
      config: CFG,
      abortSignal: signal,
      actionId: 'act_1',
      onError,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.modelId).toBe('model-1')
    expect(streamProviderCall).toHaveBeenCalledWith({
      model: {},
      prompt: 'P',
      abortSignal: signal,
      onError,
      temperature: 0.7,
      maxOutputTokens: 2048,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } },
      timeout: { totalMs: 45_000 },
    })
  })

  it('returns the resolve failure without calling the provider', async () => {
    const { streamProviderCall } = await import('./transport/provider-call')
    vi.mocked(streamProviderCall).mockClear()

    const result = streamAgentCall('narrative', {
      prompt: 'P',
      config: { ...CFG, profiles: [] },
    })

    expect(result).toEqual({ ok: false, kind: 'no-profile-assigned', target: 'narrative' })
    expect(streamProviderCall).not.toHaveBeenCalled()
  })
})
