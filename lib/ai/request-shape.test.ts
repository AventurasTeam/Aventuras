import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { generateStructured, streamText, type PromptHalves } from './generate'
import { getModel } from './model'
import { schemaToTypeScriptBlock, type JsonSchema } from './prompt-schema'
import { resolveModel, type ResolvedParams, type ResolveModelConfig } from './resolve-model'
import type { CallRetryError } from './transport/call-with-retry'
import type { CapabilityHint } from './transport/classify-provider-error'

// The real provider adapters over a capturing fetch. Every call answers a 400 (non-retryable, so
// each call sends exactly once), whose body the capability hint tests set.
vi.mock('./model', () => ({ getModel: vi.fn() }))
vi.mock('./resolve-model', () => ({ resolveModel: vi.fn() }))

type ProviderType = 'anthropic' | 'openai-compatible'
type Body = Record<string, unknown> & {
  system?: unknown
  messages: { role: string; content: unknown }[]
}

let bodies: Body[] = []

const rejectionOf = (message: string): unknown => ({
  type: 'error',
  error: { type: 'invalid_request_error', message },
})
let rejection = rejectionOf('captured')

const capture: typeof fetch = async (_input, init) => {
  bodies.push(JSON.parse(String(init?.body)) as Body)
  return new Response(JSON.stringify(rejection), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
}

const MODELS = {
  anthropic: () => createAnthropic({ apiKey: 'test-key', fetch: capture })('claude-sonnet-4-5'),
  'openai-compatible': () =>
    createOpenAICompatible({
      name: 'local',
      baseURL: 'http://127.0.0.1:9/v1',
      apiKey: 'test-key',
      fetch: capture,
    })('local-model'),
}

function useProvider(type: ProviderType, params: ResolvedParams = {}): ResolveModelConfig {
  vi.mocked(getModel).mockReturnValue(MODELS[type]())
  vi.mocked(resolveModel).mockReturnValue({
    ok: true,
    providerId: 'prov',
    providerType: type,
    modelId: 'm',
    params,
  })
  return {
    providers: [{ id: 'prov', type, displayName: 'P', apiKey: 'test-key', favoriteModelIds: [] }],
    profiles: [],
    assignments: {},
  }
}

const schema = z.object({ summary: z.string() })
const CONTRACT = `Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:\n\n${schemaToTypeScriptBlock(z.toJSONSchema(schema) as JsonSchema)}`
const CLOSING = 'Output ONLY the JSON object, no other text or markdown.'
const HALVES: PromptHalves = {
  system: '# Setting\nA drowned city.',
  user: '# Story so far\nThe bell rang.',
}
const BLANK_SYSTEM: PromptHalves = { system: '', user: HALVES.user }
const EPHEMERAL = { type: 'ephemeral' }

async function narrative(
  prompt: PromptHalves,
  config: ResolveModelConfig,
  cacheSystemPrefix?: boolean,
): Promise<Body> {
  const call = streamText('narrative', {
    prompt,
    config,
    onError: () => {},
    ...(cacheSystemPrefix === undefined ? {} : { cacheSystemPrefix }),
  })
  if (!call.ok) throw new Error(`resolve failed: ${call.kind}`)
  await call.stream.consumeStream()
  return lastBody()
}

async function structured(
  prompt: PromptHalves,
  config: ResolveModelConfig,
  cacheSystemPrefix?: boolean,
): Promise<Body> {
  await generateStructured('classifier', prompt, schema, config, new AbortController().signal, {
    actionId: null,
    ...(cacheSystemPrefix === undefined ? {} : { cacheSystemPrefix }),
  })
  return lastBody()
}

function lastBody(): Body {
  expect(bodies).toHaveLength(1)
  return bodies[0]!
}

beforeEach(() => {
  bodies = []
  rejection = rejectionOf('captured')
})

// architecture.md → System and user halves: the halves go out as a system message and
// one user message; on anthropic the last system block as sent carries the marker.
describe('request shape', () => {
  it('(a) sends the narrative halves to anthropic as a marked system block and one user message', async () => {
    const body = await narrative(HALVES, useProvider('anthropic'), true)

    expect(body.system).toEqual([{ type: 'text', text: HALVES.system, cache_control: EPHEMERAL }])
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: HALVES.user }] },
    ])
  })

  it('(b) marks the system block with the contract appended on the prompt-injection path', async () => {
    const body = await structured(HALVES, useProvider('anthropic'), true)

    expect(body.system).toEqual([
      { type: 'text', text: `${HALVES.system}\n\n${CONTRACT}`, cache_control: EPHEMERAL },
    ])
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: `${HALVES.user}\n\n${CLOSING}` }] },
    ])
  })

  it('(c) marks the contract alone when the system half is blank', async () => {
    const body = await structured(BLANK_SYSTEM, useProvider('anthropic'), true)

    expect(body.system).toEqual([{ type: 'text', text: CONTRACT, cache_control: EPHEMERAL }])
  })

  it('(d) sends no cache control to anthropic when the call does not ask', async () => {
    const config = useProvider('anthropic')

    expect(JSON.stringify(await narrative(HALVES, config))).not.toContain('cache_control')
    bodies = []
    expect(JSON.stringify(await structured(HALVES, config))).not.toContain('cache_control')
  })

  // Pins the wire only: this adapter never sends providerOptions.anthropic, so a broken gate
  // is caught by generate.test.ts's openai-compatible case, not here.
  it('(e) sends openai-compatible a system message with no cache control, even when asked', async () => {
    const config = useProvider('openai-compatible')

    const stream = await narrative(HALVES, config, true)
    expect(stream.messages[0]).toEqual({ role: 'system', content: HALVES.system })
    expect(JSON.stringify(stream)).not.toContain('cache_control')

    bodies = []
    const call = await structured(HALVES, config, true)
    expect(call.messages[0]).toEqual({ role: 'system', content: `${HALVES.system}\n\n${CONTRACT}` })
    expect(JSON.stringify(call)).not.toContain('cache_control')
  })

  it.each(['anthropic', 'openai-compatible'] as const)(
    '(f) sends %s no system message on the force-on path with a blank system half',
    async (type) => {
      const body = await structured(
        BLANK_SYSTEM,
        useProvider(type, { structuredOutput: 'force-on' }),
        true,
      )

      expect(body.system).toBeUndefined()
      expect(body.messages.map((m) => m.role)).not.toContain('system')
    },
  )
})

async function structuredFailure(config: ResolveModelConfig): Promise<CallRetryError> {
  const res = await generateStructured(
    'classifier',
    HALVES,
    schema,
    config,
    new AbortController().signal,
    { actionId: null },
  )
  if (res.status !== 'failed') throw new Error(`expected a failed call, got ${res.status}`)
  return res.error
}

async function narrativeHint(config: ResolveModelConfig): Promise<CapabilityHint | undefined> {
  let error: unknown
  const call = streamText('narrative', {
    prompt: HALVES,
    config,
    onError: (event) => {
      error = event.error
    },
  })
  if (!call.ok) throw new Error(`resolve failed: ${call.kind}`)
  await call.stream.consumeStream()
  expect(APICallError.isInstance(error)).toBe(true)
  return call.capabilityHintOf(error)
}

const REASONING: CapabilityHint = { capability: 'reasoning', matched: 'thinking' }

// generation-pipeline.md → Fatal error categories: a rejection naming a capability gets the hint
// only when the request as sent carried that capability.
describe('the capability hint', () => {
  it('hints at reasoning when an anthropic call sent its thinking setting', async () => {
    rejection = rejectionOf('thinking is not supported by this model')

    const error = await structuredFailure(useProvider('anthropic', { thinking: 2048 }))

    expect(lastBody().thinking).toEqual({ type: 'enabled', budget_tokens: 2048 })
    expect(error).toMatchObject({ tier: 'provider', possibleCapabilityMismatch: REASONING })
  })

  // The anthropic adapter sends nothing for a disabled setting; openai-compatible never gets one.
  it.each([
    ['anthropic with thinking disabled', 'anthropic', { thinking: 0 }],
    ['anthropic with no thinking setting', 'anthropic', {}],
    ['openai-compatible with a thinking budget', 'openai-compatible', { thinking: 2048 }],
  ] as const)('gives no reasoning hint for %s', async (_label, type, params) => {
    rejection = rejectionOf('thinking is not supported by this model')

    const error = await structuredFailure(useProvider(type, params))

    expect(lastBody()).not.toHaveProperty('thinking')
    expect(error).toMatchObject({ tier: 'provider' })
    expect(error).not.toHaveProperty('possibleCapabilityMismatch')
  })

  // Each adapter sends the response format its own way: anthropic never as response_format.
  it.each([
    ['anthropic', 'output_config'],
    ['openai-compatible', 'response_format'],
  ] as const)(
    'hints at structured output when a %s call sent it under force-on',
    async (type, key) => {
      rejection = rejectionOf('json_schema is not supported by this model')

      const error = await structuredFailure(useProvider(type, { structuredOutput: 'force-on' }))

      expect(lastBody()).toHaveProperty(key)
      expect(error).toMatchObject({
        possibleCapabilityMismatch: { capability: 'structuredOutput', matched: 'json_schema' },
      })
    },
  )

  // Under auto the schema goes out in the prompt, as the JSON contract.
  it('gives no structured hint under auto', async () => {
    rejection = rejectionOf('response_format is not supported by this model')

    const error = await structuredFailure(useProvider('openai-compatible'))

    expect(lastBody()).not.toHaveProperty('response_format')
    expect(error).toMatchObject({ tier: 'provider' })
    expect(error).not.toHaveProperty('possibleCapabilityMismatch')
  })

  it('hints at reasoning when an anthropic narrative sent its thinking setting', async () => {
    rejection = rejectionOf('thinking is not supported by this model')

    expect(await narrativeHint(useProvider('anthropic', { thinking: 2048 }))).toEqual(REASONING)
  })

  // The dev llama.cpp router's reply for an absent model, verbatim.
  it('gives no hint for a model id naming thinking when no thinking setting went out', async () => {
    rejection = {
      error: {
        code: 400,
        message: "model 'Qwen3-30B-A3B-Thinking-2507' not found",
        type: 'invalid_request_error',
      },
    }

    expect(
      await narrativeHint(useProvider('openai-compatible', { thinking: 2048 })),
    ).toBeUndefined()
  })

  it('gives the narrative no structured hint: it sends no response format', async () => {
    rejection = rejectionOf('response_format is not supported by this model')

    const hint = await narrativeHint(
      useProvider('openai-compatible', { structuredOutput: 'force-on' }),
    )

    expect(lastBody()).not.toHaveProperty('response_format')
    expect(hint).toBeUndefined()
  })
})
