import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { ProviderInstance } from '../db'
import { buildCallSettings, generateStructured, parseStructured, streamText } from './generate'
import { getModel } from './model'
import { resolveModel } from './resolve-model'
import { runProviderCall, streamProviderCall } from './transport/provider-call'

// Model resolution defaults to the REAL resolver (streamText's tests assert the
// full resolve → call-settings mapping); the generateStructured describe swaps
// in a canned resolution per test via beforeEach. Store-backed model lookup and
// provider I/O are always faked.
const actualResolveModel = (
  await vi.importActual<{ resolveModel: typeof resolveModel }>('./resolve-model')
).resolveModel
vi.mock('./resolve-model', async (orig) => {
  const actual = await orig<Record<string, unknown>>()
  return { ...actual, resolveModel: vi.fn(actual.resolveModel as typeof resolveModel) }
})
vi.mock('./model', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getModel: vi.fn(() => ({}) as never),
}))
vi.mock('./transport/provider-call', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runProviderCall: vi.fn(() => Promise.resolve({ text: '{"description":"A tale."}' })),
  streamProviderCall: vi.fn(() => ({ textStream: (async function* () {})() })),
}))

const schema = z.object({ description: z.string() })

const PROMPT = { system: '', user: 'build prompt text' }

const STRUCTURED_CFG = {
  providers: [],
  profiles: [],
  assignments: { 'wizard-assist': 'prof' },
}

const provider = {
  id: 'prov-1',
  type: 'anthropic' as const,
  displayName: 'Anthropic',
  apiKey: 'key',
  favoriteModelIds: [],
}

const STREAM_CFG = {
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
}

describe('buildCallSettings', () => {
  it('maps every profile parameter to its SDK option (anthropic)', () => {
    expect(
      buildCallSettings(
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
    expect(buildCallSettings({ thinking: 0 }, 'anthropic')).toEqual({
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } },
    })
  })

  it('drops thinking for non-anthropic providers', () => {
    expect(buildCallSettings({ thinking: 1024 }, 'openai-compatible')).toEqual({})
  })

  it('maps an empty params object to no options', () => {
    expect(buildCallSettings({}, 'anthropic')).toEqual({})
  })
})

describe('streamText', () => {
  beforeEach(() => {
    vi.mocked(resolveModel).mockImplementation(actualResolveModel)
  })

  it('resolves the target and passes both halves + mapped options to the stream call', async () => {
    const { streamProviderCall } = await import('./transport/provider-call')
    const onError = () => {}
    const signal = new AbortController().signal

    const result = streamText('narrative', {
      prompt: { system: ' S\n', user: 'P' },
      config: STREAM_CFG,
      abortSignal: signal,
      actionId: 'act_1',
      onError,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.modelId).toBe('model-1')
    expect(streamProviderCall).toHaveBeenCalledWith({
      model: {},
      system: ' S\n',
      prompt: 'P',
      abortSignal: signal,
      onError,
      temperature: 0.7,
      maxOutputTokens: 2048,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } },
      timeout: { totalMs: 45_000 },
    })
  })

  // architecture.md → System and user halves: providers reject an empty system message.
  it.each(['', ' \n '])('sends no system message for a blank system half (%j)', async (system) => {
    const { streamProviderCall } = await import('./transport/provider-call')
    vi.mocked(streamProviderCall).mockClear()

    streamText('narrative', { prompt: { system, user: 'P' }, config: STREAM_CFG })

    expect(streamProviderCall).toHaveBeenCalledOnce()
    const call = vi.mocked(streamProviderCall).mock.calls.at(-1)?.[0]
    expect(call).not.toHaveProperty('system')
    expect(call).toHaveProperty('prompt', 'P')
  })

  it('returns the resolve failure without calling the provider', async () => {
    const { streamProviderCall } = await import('./transport/provider-call')
    vi.mocked(streamProviderCall).mockClear()

    const result = streamText('narrative', {
      prompt: { system: 'S', user: 'P' },
      config: { ...STREAM_CFG, profiles: [] },
    })

    expect(result).toEqual({ ok: false, kind: 'no-profile-assigned', target: 'narrative' })
    expect(streamProviderCall).not.toHaveBeenCalled()
  })
})

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
  beforeEach(async () => {
    vi.mocked(resolveModel).mockImplementation(() => ({
      ok: true,
      providerId: 'p',
      modelId: 'm',
      params: {},
    }))
    const { runProviderCall } = await import('./transport/provider-call')
    vi.mocked(runProviderCall).mockImplementation(() =>
      Promise.resolve({ text: '{"description":"A tale."}' } as never),
    )
  })

  it('resolves the target, calls the provider, and parses structured output', async () => {
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
    )
    expect(res).toEqual({ status: 'ok', value: { description: 'A tale.' } })
  })

  it('passes the system half as the system option and the user half as the prompt', async () => {
    const { runProviderCall } = await import('./transport/provider-call')
    vi.mocked(runProviderCall).mockClear()
    await generateStructured(
      'wizard-assist',
      { system: ' S\n', user: 'P' },
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
    )
    expect(runProviderCall).toHaveBeenCalledOnce()
    const call = vi.mocked(runProviderCall).mock.calls.at(-1)?.[0]
    expect(call).toHaveProperty('system', ' S\n')
    expect(call).toHaveProperty('prompt', 'P')
  })

  it.each(['', ' \n '])('sends no system option for a blank system half (%j)', async (system) => {
    const { runProviderCall } = await import('./transport/provider-call')
    vi.mocked(runProviderCall).mockClear()
    await generateStructured(
      'wizard-assist',
      { system, user: 'P' },
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
    )
    expect(runProviderCall).toHaveBeenCalledOnce()
    const call = vi.mocked(runProviderCall).mock.calls.at(-1)?.[0]
    expect(call).not.toHaveProperty('system')
    expect(call).toHaveProperty('prompt', 'P')
  })

  it('applies resolved profile params to the provider call', async () => {
    const { runProviderCall } = await import('./transport/provider-call')
    vi.mocked(resolveModel).mockReturnValueOnce({
      ok: true,
      providerId: 'p',
      modelId: 'm',
      params: { temperature: 0.5, maxOutput: 100 },
    })
    await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
    )
    expect(runProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.5, maxOutputTokens: 100 }),
    )
  })

  it('returns not-configured when the resolver fails', async () => {
    vi.mocked(resolveModel).mockReturnValueOnce({
      ok: false,
      kind: 'no-profile-assigned',
      target: 'wizard-assist',
    })
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
    )
    expect(res.status).toBe('not-configured')
  })
  it('returns failed when the call/parse ultimately fails', async () => {
    const { runProviderCall } = await import('./transport/provider-call')
    vi.mocked(runProviderCall).mockResolvedValue({ text: 'not json <<<' } as never)
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
    )
    expect(res.status).toBe('failed')
  })

  it('returns failed (not a raw throw) for a schema JSON Schema cannot represent', async () => {
    const unrepresentable = z.object({ description: z.string() }).transform((v) => v.description)
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      unrepresentable as never,
      STRUCTURED_CFG,
      new AbortController().signal,
    )
    expect(res.status).toBe('failed')
  })
})

type SentMessage = { role: string; providerOptions?: { anthropic?: { cacheControl?: unknown } } }

/** A provider model that records the params its wrappers hand it, then fails the call. */
function recordingModel() {
  const seen: { prompt: SentMessage[] }[] = []
  const record = async (params: { prompt: SentMessage[] }) => {
    seen.push(params)
    throw new Error('recorded')
  }
  return {
    seen,
    model: {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'm',
      supportedUrls: {},
      doGenerate: record,
      doStream: record,
    },
  }
}

/**
 * Runs `sent`'s middleware over a system + user prompt and returns the cache
 * control the system message carried when it reached the provider model.
 */
async function systemCacheControl(
  sent: unknown,
  inner: ReturnType<typeof recordingModel>,
  method: 'doGenerate' | 'doStream',
): Promise<unknown> {
  const model = sent as Record<typeof method, (params: unknown) => Promise<unknown>>
  await model[method]({
    prompt: [
      { role: 'system', content: 'S' },
      { role: 'user', content: [{ type: 'text', text: 'P' }] },
    ],
  }).catch(() => undefined)
  return inner.seen.at(-1)?.prompt.find((m) => m.role === 'system')?.providerOptions?.anthropic
    ?.cacheControl
}

// architecture.md → System and user halves: the marker goes on `anthropic` providers only,
// and only on calls that ask for it.
describe('cache marker', () => {
  const config = (type: string) => ({
    // ProviderInstance['type'] has no 'stub': a stub row reaches config.providers only at
    // runtime, through app settings, and the resolver's lookup ignores type.
    providers: [
      { id: 'prov-1', type, displayName: 'P', apiKey: 'k', favoriteModelIds: [] },
    ] as unknown as ProviderInstance[],
    profiles: [
      {
        id: 'prof-n',
        kind: 'narrative' as const,
        name: 'N',
        modelRef: { providerId: 'prov-1', modelId: 'm' },
      },
      {
        id: 'prof-c',
        kind: 'agent' as const,
        name: 'C',
        modelRef: { providerId: 'prov-1', modelId: 'm' },
      },
    ],
    assignments: { classifier: 'prof-c' },
  })

  beforeEach(() => {
    vi.mocked(resolveModel).mockImplementation(actualResolveModel)
    vi.mocked(runProviderCall).mockResolvedValue({ text: '{"description":"A tale."}' } as never)
  })

  async function streamMark(type: string, cacheSystemPrefix: boolean | undefined) {
    const inner = recordingModel()
    vi.mocked(getModel).mockReturnValueOnce(inner.model as never)
    streamText('narrative', {
      prompt: { system: 'S', user: 'P' },
      config: config(type),
      ...(cacheSystemPrefix === undefined ? {} : { cacheSystemPrefix }),
    })
    const sent = vi.mocked(streamProviderCall).mock.calls.at(-1)?.[0].model
    return systemCacheControl(sent, inner, 'doStream')
  }

  async function structuredMark(type: string, cacheSystemPrefix: boolean | undefined) {
    const inner = recordingModel()
    vi.mocked(getModel).mockReturnValueOnce(inner.model as never)
    await generateStructured(
      'classifier',
      { system: 'S', user: 'P' },
      schema,
      config(type),
      new AbortController().signal,
      cacheSystemPrefix === undefined ? undefined : { cacheSystemPrefix },
    )
    const sent = vi.mocked(runProviderCall).mock.calls.at(-1)?.[0].model
    return systemCacheControl(sent, inner, 'doGenerate')
  }

  it('marks the system message on an anthropic provider that asks, in both calls', async () => {
    expect(await streamMark('anthropic', true)).toEqual({ type: 'ephemeral' })
    expect(await structuredMark('anthropic', true)).toEqual({ type: 'ephemeral' })
  })

  it.each([
    ['an openai-compatible provider that asks', 'openai-compatible', true],
    ['an anthropic provider that does not ask', 'anthropic', undefined],
    ['a stub provider row that asks', 'stub', true],
  ])('leaves both calls unmarked on %s', async (_label, type, cacheSystemPrefix) => {
    expect(await streamMark(type, cacheSystemPrefix)).toBeUndefined()
    expect(await structuredMark(type, cacheSystemPrefix)).toBeUndefined()
  })

  it('hands the stream call the unwrapped model when it marks nothing', () => {
    const inner = recordingModel()
    vi.mocked(getModel).mockReturnValueOnce(inner.model as never)

    streamText('narrative', {
      prompt: { system: 'S', user: 'P' },
      config: config('openai-compatible'),
      cacheSystemPrefix: true,
    })

    expect(vi.mocked(streamProviderCall).mock.calls.at(-1)?.[0].model).toBe(inner.model)
  })
})
