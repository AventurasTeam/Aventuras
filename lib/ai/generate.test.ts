import { APICallError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { z } from 'zod'

import { logger, type Logger } from '@/lib/diagnostics'

import type { ProviderInstance } from '../db'
import { describeContextWindow, type ContextWindowFailure } from './context-window'
import {
  buildCallSettings,
  describeCallRetryError,
  generateStructured,
  parseStructured,
  profileTimeoutMs,
  streamText,
  type PromptHalves,
} from './generate'
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

const structuredProvider = {
  id: 'p',
  type: 'openai-compatible' as const,
  displayName: 'Local',
  apiKey: 'key',
  favoriteModelIds: [],
}

const STRUCTURED_CFG = {
  providers: [structuredProvider],
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
  // The timeout stays out: the SDK would build AbortSignal.timeout, which React Native lacks.
  it('maps every profile parameter but the timeout to its SDK option (anthropic)', () => {
    expect(
      buildCallSettings(
        { temperature: 0.7, maxOutput: 2048, thinking: 1024, timeout: 45 },
        'anthropic',
      ),
    ).toEqual({
      temperature: 0.7,
      maxOutputTokens: 2048,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } },
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

describe('profileTimeoutMs', () => {
  it('reads seconds as milliseconds', () => {
    expect(profileTimeoutMs(45)).toBe(45_000)
  })

  // A timer fires at once on 0 and on a non-finite delay.
  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined])(
    'reads an invalid timeout (%s) as none',
    (timeout) => {
      expect(profileTimeoutMs(timeout)).toBeUndefined()
    },
  )

  it("caps a huge timeout at setTimeout's largest delay", () => {
    expect(profileTimeoutMs(9_999_999)).toBe(2_147_483_647)
  })
})

describe('streamText', () => {
  beforeEach(() => {
    vi.mocked(resolveModel).mockImplementation(actualResolveModel)
  })

  it('resolves the target; streams both halves verbatim with the mapped options', () => {
    const onError = () => {}
    const signal = new AbortController().signal
    const untimed = {
      ...STREAM_CFG,
      profiles: STREAM_CFG.profiles.map(({ timeout: _, ...profile }) => profile),
    }

    const result = streamText('narrative', {
      prompt: { system: ' S\n', user: ' P\n' },
      config: untimed,
      abortSignal: signal,
      actionId: 'act_1',
      onError,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.modelId).toBe('model-1')
    expect(streamProviderCall).toHaveBeenCalledWith({
      // Wrapped even with no cache marker: the window check rides every stream.
      model: expect.objectContaining({ doStream: expect.any(Function) }),
      system: ' S\n',
      prompt: ' P\n',
      abortSignal: signal,
      onError,
      onFinish: expect.any(Function),
      temperature: 0.7,
      maxOutputTokens: 2048,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } },
    })
  })

  // generation-pipeline.md → Cut-off replies: the narrative's cause rule needs the profile's limit.
  it("returns the profile's max output, and undefined when it sets none", () => {
    const untimed = STREAM_CFG.profiles.map(({ timeout: _, ...profile }) => profile)
    const set = streamText('narrative', {
      prompt: PROMPT,
      config: { ...STREAM_CFG, profiles: untimed },
    })
    const unset = streamText('narrative', {
      prompt: PROMPT,
      config: {
        ...STREAM_CFG,
        profiles: untimed.map(({ maxOutput: _, ...profile }) => profile),
      },
    })

    expect(set.ok && set.maxOutput).toBe(2048)
    expect(unset.ok).toBe(true)
    if (unset.ok) expect(unset.maxOutput).toBeUndefined()
  })

  describe("a profile's timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const streamed = (abortSignal?: AbortSignal) => {
      vi.mocked(streamProviderCall).mockClear()
      const result = streamText('narrative', {
        prompt: PROMPT,
        config: STREAM_CFG,
        ...(abortSignal ? { abortSignal } : {}),
      })
      const call = vi.mocked(streamProviderCall).mock.calls.at(-1)?.[0]
      if (!result.ok || call === undefined) throw new Error('expected a stream')
      return { result, call }
    }

    it('bounds the stream with its own signal, never the SDK option', () => {
      const { result, call } = streamed()

      expect(call).not.toHaveProperty('timeout')
      expect(result.timeoutMs).toBe(45_000)
      vi.advanceTimersByTime(44_999)
      expect(call.abortSignal?.aborted).toBe(false)
      expect(result.timedOut()).toBe(false)
      vi.advanceTimersByTime(1)
      expect(call.abortSignal?.aborted).toBe(true)
      expect(result.timedOut()).toBe(true)
    })

    it('reads a cancel as no timeout, and a finished stream disarms the bound', () => {
      const controller = new AbortController()
      const cancelled = streamed(controller.signal)
      controller.abort()
      expect(cancelled.call.abortSignal?.aborted).toBe(true)
      expect(cancelled.result.timedOut()).toBe(false)

      const finished = streamed()
      finished.call.onFinish?.({} as never)
      vi.advanceTimersByTime(45_000)
      expect(finished.call.abortSignal?.aborted).toBe(false)
      expect(finished.result.timedOut()).toBe(false)
    })

    it('disarms the bound when the stream reports an abort', () => {
      const { result, call } = streamed()
      call.onAbort?.({ steps: [] })
      vi.advanceTimersByTime(45_000)
      expect(call.abortSignal?.aborted).toBe(false)
      expect(result.timedOut()).toBe(false)
    })

    // The SDK calls onError for each error part and keeps the stream open, so a stall can follow.
    it("keeps the bound armed through an error part, still handing it to the caller's onError", () => {
      const onError = vi.fn()
      vi.mocked(streamProviderCall).mockClear()
      const result = streamText('narrative', { prompt: PROMPT, config: STREAM_CFG, onError })
      const call = vi.mocked(streamProviderCall).mock.calls.at(-1)?.[0]
      if (!result.ok || call === undefined) throw new Error('expected a stream')

      const error = new Error('bad chunk')
      call.onError?.({ error })
      expect(onError).toHaveBeenCalledWith({ error })
      vi.advanceTimersByTime(45_000)
      expect(call.abortSignal?.aborted).toBe(true)
      expect(result.timedOut()).toBe(true)
    })
  })

  // architecture.md → System and user halves: providers reject an empty system message.
  it.each(['', ' \n '])('sends no system message for a blank system half (%j)', (system) => {
    vi.mocked(streamProviderCall).mockClear()

    streamText('narrative', { prompt: { system, user: 'P' }, config: STREAM_CFG })

    expect(streamProviderCall).toHaveBeenCalledOnce()
    const call = vi.mocked(streamProviderCall).mock.calls.at(-1)?.[0]
    expect(call).not.toHaveProperty('system')
    expect(call).toHaveProperty('prompt', 'P')
  })

  it('returns the resolve failure without calling the provider', () => {
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
  it('restores a key that lost its end quote, at any depth', () => {
    const nested = z.object({ items: z.array(z.object({ name: z.string(), turn: z.string() })) })
    const raw = '{"items": [{"name: "Brann", "turn":"t2"}, {"name:"Maela", "turn": "t4"}]}'
    expect(parseStructured(raw, nested)).toEqual({
      items: [
        { name: 'Brann', turn: 't2' },
        { name: 'Maela', turn: 't4' },
      ],
    })
  })
  it('keeps a key the object already has over a restored one', () => {
    expect(parseStructured('{"description": "Hi", "description: "No"}', schema).description).toBe(
      'Hi',
    )
  })
  it('leaves a strict document’s keys alone', () => {
    expect(parseStructured('{"a:": 1}', z.record(z.string(), z.number()))).toEqual({ 'a:': 1 })
  })

  describe('a pretty-printed key that lost its closing quote', () => {
    const entry = z.object({
      ref: z.string(),
      severity: z.number(),
      icon: z.string(),
      name: z.string(),
      placements: z.array(z.string()),
      tags: z.array(z.string()),
    })
    // The tag opens like a key, but the schema names no `warning`: it stays a string.
    const base = [
      '{',
      '  "ref": "c1",',
      '  "severity": 0.5,',
      '  "icon": "swords",',
      '  "name": "",',
      '  "placements": [],',
      '  "tags": [',
      '    "warning: hot"',
      '  ]',
      '}',
    ].join('\n')
    it.each([
      ['the value still quoted', '"ref": "c1",', '"ref: "c1",'],
      ['no space after the colon', '"ref": "c1",', '"ref:"c1",'],
      ['no closing quote at all', '"severity": 0.5,', '"severity: 0.5,'],
      ['the quote after a JSON value', '"placements": [],', '"placements: []",'],
      ['the quote after a bare word', '"icon": "swords",', '"icon: swords",'],
      ['the quote after nothing', '"name": "",', '"name: ",'],
      ['a value opening on the line', '"tags": [', '"tags: ['],
      ['a stray colon inside the quotes', '"icon": "swords",', '"icon:": "swords",'],
    ])('restores it with %s', (_, valid, slipped) => {
      expect(base).toContain(valid)
      expect(parseStructured(base.replace(valid, slipped), entry)).toEqual(JSON.parse(base))
    })
    it('restores a stray colon in a reply another slip sends to jsonrepair', () => {
      const raw = base
        .replace('"icon": "swords",', '"icon:": "swords",')
        .replace('"severity": 0.5,', '"severity: 0.5,')
      expect(parseStructured(raw, entry)).toEqual(JSON.parse(base))
    })
  })
})

describe('generateStructured', () => {
  beforeEach(() => {
    vi.mocked(resolveModel).mockImplementation(() => ({
      ok: true,
      providerId: structuredProvider.id,
      providerType: structuredProvider.type,
      modelId: 'm',
      params: {},
    }))
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
      { actionId: null },
    )
    expect(res).toEqual({ status: 'ok', value: { description: 'A tale.' }, recoverable: [] })
  })

  // observability.md → actionId threading: the model's fetch capture links to the run's action.
  it("builds the model with the run's action id, and with none outside a run", async () => {
    vi.mocked(getModel).mockClear()
    await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
      {
        actionId: 'act_1',
      },
    )
    await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
      { actionId: null },
    )
    expect(vi.mocked(getModel).mock.calls.map((call) => call[2])).toEqual(['act_1', undefined])
  })

  // generation-pipeline.md → Two retry tiers: every arm carries the attempts it retried.
  it('returns the parse retry it recovered from beside the value', async () => {
    vi.mocked(runProviderCall)
      .mockResolvedValueOnce({ text: 'not json <<<' } as never)
      .mockResolvedValueOnce({ text: '{"description":"A tale."}' } as never)
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
      { actionId: null },
    )
    expect(res).toEqual({
      status: 'ok',
      value: { description: 'A tale.' },
      recoverable: [{ tier: 'parse', detail: expect.any(String), attempt: 0 }],
    })
  })

  it('returns the attempts it retried before failing', async () => {
    vi.mocked(runProviderCall).mockResolvedValue({ text: 'not json <<<' } as never)
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
      { actionId: null },
    )
    expect(res).toEqual({
      status: 'failed',
      error: { tier: 'parse', detail: expect.any(String), attempt: 1 },
      recoverable: [{ tier: 'parse', detail: expect.any(String), attempt: 0 }],
    })
  })

  it('returns an aborted call with the attempts it retried, none before its first', async () => {
    const controller = new AbortController()
    controller.abort()
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      controller.signal,
      { actionId: null },
    )
    expect(res).toEqual({ status: 'aborted', recoverable: [] })
  })

  it('returns the parse retry a call recovered from before it was aborted mid-flight', async () => {
    const controller = new AbortController()
    vi.mocked(runProviderCall)
      .mockResolvedValueOnce({ text: 'not json <<<' } as never)
      .mockImplementationOnce(async () => {
        controller.abort()
        throw new Error('aborted')
      })
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      controller.signal,
      { actionId: null },
    )
    expect(res).toEqual({
      status: 'aborted',
      recoverable: [{ tier: 'parse', detail: expect.any(String), attempt: 0 }],
    })
  })

  async function sentProviderCall(prompt: PromptHalves) {
    vi.mocked(runProviderCall).mockClear()
    await generateStructured(
      'wizard-assist',
      prompt,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
      { actionId: null },
    )
    expect(runProviderCall).toHaveBeenCalledOnce()
    return vi.mocked(runProviderCall).mock.calls.at(-1)?.[0]
  }

  it('passes both halves verbatim: system as the system option, user as the prompt', async () => {
    const call = await sentProviderCall({ system: ' S\n', user: ' P\n' })
    expect(call).toHaveProperty('system', ' S\n')
    expect(call).toHaveProperty('prompt', ' P\n')
  })

  it.each(['', ' \n '])('sends no system option for a blank system half (%j)', async (system) => {
    const call = await sentProviderCall({ system, user: 'P' })
    expect(call).not.toHaveProperty('system')
    expect(call).toHaveProperty('prompt', 'P')
  })

  it('applies resolved profile params to the provider call', async () => {
    vi.mocked(resolveModel).mockReturnValueOnce({
      ok: true,
      providerId: structuredProvider.id,
      providerType: structuredProvider.type,
      modelId: 'm',
      params: { temperature: 0.5, maxOutput: 100 },
    })
    await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
      { actionId: null },
    )
    expect(runProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.5, maxOutputTokens: 100 }),
    )
  })

  it("bounds each attempt by the profile's timeout, retrying the first as a timeout", async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(resolveModel).mockReturnValueOnce({
        ok: true,
        providerId: structuredProvider.id,
        providerType: structuredProvider.type,
        modelId: 'm',
        params: { timeout: 30 },
      })
      const attempts: AbortSignal[] = []
      vi.mocked(runProviderCall).mockImplementation(({ abortSignal }) => {
        if (abortSignal === undefined) throw new Error('expected a bound')
        attempts.push(abortSignal)
        return new Promise((_, reject) => {
          abortSignal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        })
      })
      const outer = new AbortController()

      const pending = generateStructured(
        'wizard-assist',
        PROMPT,
        schema,
        STRUCTURED_CFG,
        outer.signal,
        { actionId: null },
      )
      await vi.advanceTimersByTimeAsync(29_999)
      expect(attempts.map((signal) => signal.aborted)).toEqual([false])
      await vi.advanceTimersByTimeAsync(31_000)

      expect(await pending).toEqual({
        status: 'failed',
        error: { tier: 'provider', reason: 'timeout' },
        recoverable: [{ tier: 'provider', reason: 'timeout' }],
      })
      expect(attempts.map((signal) => signal.aborted)).toEqual([true, true])
      expect(outer.signal.aborted).toBe(false)
      expect(vi.mocked(runProviderCall).mock.calls[0]?.[0]).not.toHaveProperty('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  // Left armed, a bound would hold a timer per attempt and a listener on the caller's signal.
  it("disarms an attempt's bound once the attempt settles", async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(resolveModel).mockReturnValueOnce({
        ok: true,
        providerId: structuredProvider.id,
        providerType: structuredProvider.type,
        modelId: 'm',
        params: { timeout: 30 },
      })
      const attempts: AbortSignal[] = []
      vi.mocked(runProviderCall).mockImplementation(({ abortSignal }) => {
        if (abortSignal === undefined) throw new Error('expected a bound')
        attempts.push(abortSignal)
        return Promise.resolve({ text: '{"description":"A tale."}' } as never)
      })
      const outer = new AbortController()

      const res = await generateStructured(
        'wizard-assist',
        PROMPT,
        schema,
        STRUCTURED_CFG,
        outer.signal,
        { actionId: null },
      )

      expect(res.status).toBe('ok')
      expect(vi.getTimerCount()).toBe(0)
      outer.abort()
      expect(attempts.map((signal) => signal.aborted)).toEqual([false])
    } finally {
      vi.useRealTimers()
    }
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
      { actionId: null },
    )
    expect(res.status).toBe('not-configured')
  })
  it('returns failed when the call/parse ultimately fails', async () => {
    vi.mocked(runProviderCall).mockResolvedValue({ text: 'not json <<<' } as never)
    const res = await generateStructured(
      'wizard-assist',
      PROMPT,
      schema,
      STRUCTURED_CFG,
      new AbortController().signal,
      { actionId: null },
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
      { actionId: null },
    )
    expect(res).toEqual({
      status: 'failed',
      error: { tier: 'parse', detail: expect.any(String), attempt: 0 },
      recoverable: [],
    })
  })

  // generation-pipeline.md → Cut-off replies: refused, not repaired.
  describe('a reply the server cut off at its length limit', () => {
    let warn: MockInstance<Logger['warn']>

    beforeEach(() => {
      warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      vi.mocked(runProviderCall).mockClear()
      vi.mocked(resolveModel).mockImplementation(() => ({
        ok: true,
        providerId: 'prov-1',
        providerType: 'openai-compatible',
        modelId: 'model-1',
        params: { maxOutput: 256 },
      }))
    })
    afterEach(() => {
      warn.mockRestore()
    })

    function reply(text: string, finishReason: string | undefined, outputTokens?: number) {
      vi.mocked(runProviderCall).mockResolvedValue({
        text,
        finishReason,
        usage:
          outputTokens === undefined
            ? undefined
            : { outputTokens, outputTokenDetails: { reasoningTokens: 40 } },
      } as never)
    }

    function call(actionId: string | null = 'act_1') {
      return generateStructured(
        'classifier',
        PROMPT,
        schema,
        STRUCTURED_CFG,
        new AbortController().signal,
        { actionId },
      )
    }

    const cutOffLogs = () => warn.mock.calls.filter(([kind]) => kind === 'provider.reply_cut_off')

    it('fails a reply that will not parse strictly after one call, with the numbers', async () => {
      // jsonrepair would close this into {"description":"A ta"}.
      reply('{"description":"A ta', 'length', 256)
      expect(await call()).toEqual({
        status: 'failed',
        error: {
          tier: 'reply-cut-off',
          cause: 'max-output',
          outputTokens: 256,
          reasoningTokens: 40,
          maxOutput: 256,
          window: null,
          providerId: 'prov-1',
          modelId: 'model-1',
        },
        recoverable: [],
      })
      expect(runProviderCall).toHaveBeenCalledOnce()
    })

    it.each([
      ['a trailing comma', '{"description":"A tale.",}', schema],
      ['an unclosed list', '{"items":["a","b"', z.object({ items: z.array(z.string()) })],
    ])('refuses a reply with %s that jsonrepair would fix', async (_label, text, replySchema) => {
      reply(text, 'length', 256)
      const res = await generateStructured(
        'classifier',
        PROMPT,
        replySchema as z.ZodType<unknown>,
        STRUCTURED_CFG,
        new AbortController().signal,
        { actionId: null },
      )
      expect(res).toMatchObject({ status: 'failed', error: { tier: 'reply-cut-off' } })
      expect(runProviderCall).toHaveBeenCalledOnce()
    })

    it('refuses a complete document of the wrong shape, after one call', async () => {
      reply('{"wrong":1}', 'length', 256)
      expect(await call()).toMatchObject({ status: 'failed', error: { tier: 'reply-cut-off' } })
      expect(runProviderCall).toHaveBeenCalledOnce()
    })

    // Repair would close this into a shorter list, and a pass would save it as whole.
    it('refuses a filtered reply only repair could close, retrying it as a parse failure', async () => {
      reply('{"items":["a","b"', 'content-filter')
      const res = await generateStructured(
        'classifier',
        PROMPT,
        z.object({ items: z.array(z.string()) }) as z.ZodType<unknown>,
        STRUCTURED_CFG,
        new AbortController().signal,
        { actionId: null },
      )
      expect(res).toMatchObject({ status: 'failed', error: { tier: 'parse' } })
      expect(res.status === 'failed' && describeCallRetryError(res.error)).toContain(
        'content filter stopped the reply',
      )
      expect(runProviderCall).toHaveBeenCalledTimes(2)
    })

    it('accepts a filtered reply that parses strictly', async () => {
      reply('{"description":"A tale."}', 'content-filter')
      expect(await call()).toEqual({
        status: 'ok',
        value: { description: 'A tale.' },
        recoverable: [],
      })
    })

    it('still repairs a reply the model finished', async () => {
      reply('{"description":"A tale.",}', 'stop')
      expect(await call()).toMatchObject({ status: 'ok', value: { description: 'A tale.' } })
    })

    it('accepts a reply that parses strictly, a complete document at the limit', async () => {
      reply('{"description":"A tale."}', 'length', 256)
      expect(await call()).toEqual({
        status: 'ok',
        value: { description: 'A tale.' },
        recoverable: [],
      })
    })

    it.each([['stop'], [undefined]])(
      'still repairs a malformed reply whose finish reason is %s',
      async (finishReason) => {
        reply('{"description":"A tale.",}', finishReason, 256)
        expect(await call()).toEqual({
          status: 'ok',
          value: { description: 'A tale.' },
          recoverable: [],
        })
        expect(cutOffLogs()).toEqual([])
      },
    )

    it('warns once on a refusal, with the numbers, the action and the syntax error', async () => {
      reply('{"description":"A ta', 'length', 256)
      await call('act_1')
      expect(cutOffLogs()).toEqual([
        [
          'provider.reply_cut_off',
          {
            outcome: 'refused',
            target: 'classifier',
            cause: 'max-output',
            outputTokens: 256,
            reasoningTokens: 40,
            maxOutput: 256,
            window: null,
            providerId: 'prov-1',
            modelId: 'model-1',
            parseError: expect.stringContaining('Unterminated string in JSON'),
          },
          { actionId: 'act_1' },
        ],
      ])
    })

    it('warns once on refusing a document of the wrong shape, with the schema error', async () => {
      reply('{"wrong":1}', 'length', 256)
      await call('act_1')
      expect(cutOffLogs()).toEqual([
        [
          'provider.reply_cut_off',
          expect.objectContaining({
            outcome: 'refused',
            parseError: expect.stringMatching(/"code": "invalid_type"[\s\S]*"description"/),
          }),
          { actionId: 'act_1' },
        ],
      ])
    })

    it('logs no cut-off when a call runs out of parse retries on finished replies', async () => {
      reply('not json <<<', 'stop', 256)
      expect(await call()).toMatchObject({ status: 'failed', error: { tier: 'parse' } })
      expect(runProviderCall).toHaveBeenCalledTimes(2)
      expect(cutOffLogs()).toEqual([])
    })

    it('logs no cut-off when the provider call fails', async () => {
      vi.mocked(runProviderCall).mockRejectedValue(
        new APICallError({
          message: 'unauthorized',
          url: 'u',
          requestBodyValues: {},
          statusCode: 401,
        }),
      )
      expect(await call()).toMatchObject({ status: 'failed', error: { tier: 'provider' } })
      expect(cutOffLogs()).toEqual([])
    })

    it('warns on a strict accept at the limit, a sign the limit is tight', async () => {
      vi.mocked(resolveModel).mockImplementation(() => ({
        ok: true,
        providerId: 'prov-1',
        providerType: 'openai-compatible',
        modelId: 'model-1',
        params: {},
      }))
      reply('{"description":"A tale."}', 'length', 120)
      await call('act_2')
      expect(cutOffLogs()).toEqual([
        [
          'provider.reply_cut_off',
          {
            outcome: 'accepted',
            target: 'classifier',
            cause: 'unknown',
            outputTokens: 120,
            reasoningTokens: 40,
            maxOutput: null,
            window: null,
            providerId: 'prov-1',
            modelId: 'model-1',
          },
          { actionId: 'act_2' },
        ],
      ])
    })

    it('warns with no action outside a run', async () => {
      reply('{"description":"A ta', 'length')
      await call(null)
      expect(cutOffLogs()).toEqual([
        [
          'provider.reply_cut_off',
          expect.objectContaining({ outcome: 'refused', cause: 'max-output', outputTokens: null }),
          undefined,
        ],
      ])
    })
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

/** The cache control `sent`'s middleware leaves on the system message reaching `inner`. */
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
  expect(inner.seen).toHaveLength(1)
  return inner.seen.at(-1)?.prompt.find((m) => m.role === 'system')?.providerOptions?.anthropic
    ?.cacheControl
}

// architecture.md → System and user halves: marker on `anthropic` only, and only when asked.
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
      { actionId: null, ...(cacheSystemPrefix === undefined ? {} : { cacheSystemPrefix }) },
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
    ['an anthropic provider that declines', 'anthropic', false],
    ['a stub provider row that asks', 'stub', true],
  ])('leaves both calls unmarked on %s', async (_label, type, cacheSystemPrefix) => {
    expect(await streamMark(type, cacheSystemPrefix)).toBeUndefined()
    expect(await structuredMark(type, cacheSystemPrefix)).toBeUndefined()
  })
})

describe('describeCallRetryError', () => {
  it('reads a provider failure as its detail, or its reason when it has none', () => {
    expect(
      describeCallRetryError({ tier: 'provider', reason: 'network', detail: '503 upstream' }),
    ).toBe('503 upstream')
    expect(describeCallRetryError({ tier: 'provider', reason: 'timeout' })).toBe('timeout')
  })

  it('reads a parse failure as its detail', () => {
    expect(describeCallRetryError({ tier: 'parse', detail: 'bad json', attempt: 1 })).toBe(
      'bad json',
    )
  })

  it('describes a cut-off, naming its cause', () => {
    expect(
      describeCallRetryError({
        tier: 'reply-cut-off',
        cause: 'unknown',
        outputTokens: 4096,
        reasoningTokens: null,
        maxOutput: null,
        window: null,
        providerId: 'prov-1',
        modelId: 'model-1',
      }),
    ).toBe('reply cut off (unknown): 4096 output tokens; model model-1 on provider prov-1')
  })

  it('describes a context-window failure as describeContextWindow does', () => {
    const failure: ContextWindowFailure = {
      detectedBy: 'provider',
      estimate: 71_234,
      window: null,
      windowSource: 'unknown',
      providerId: 'prov-1',
      modelId: 'model-1',
      detail: 'prompt is too long',
    }
    const line = describeCallRetryError({ tier: 'context-window', ...failure })
    expect(line).toBe(describeContextWindow(failure))
    expect(line).toContain('model-1')
  })
})
