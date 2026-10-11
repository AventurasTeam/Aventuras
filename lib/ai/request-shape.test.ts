import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { generateStructured, streamText, type PromptHalves } from './generate'
import { getModel } from './model'
import { schemaToTypeScriptBlock, type JsonSchema } from './prompt-schema'
import { resolveModel, type ResolvedParams, type ResolveModelConfig } from './resolve-model'

// The real provider adapters over a capturing fetch: only the request body is under
// test, so every call answers 400 (non-retryable, so each call sends exactly once).
vi.mock('./model', () => ({ getModel: vi.fn() }))
vi.mock('./resolve-model', () => ({ resolveModel: vi.fn() }))

type ProviderType = 'anthropic' | 'openai-compatible'
type Body = Record<string, unknown> & {
  system?: unknown
  messages: { role: string; content: unknown }[]
}

let bodies: Body[] = []

const capture: typeof fetch = async (_input, init) => {
  bodies.push(JSON.parse(String(init?.body)) as Body)
  return new Response(
    JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'captured' },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
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
  vi.mocked(resolveModel).mockReturnValue({ ok: true, providerId: 'prov', modelId: 'm', params })
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
  await generateStructured(
    'classifier',
    prompt,
    schema,
    config,
    new AbortController().signal,
    cacheSystemPrefix === undefined ? undefined : { cacheSystemPrefix },
  )
  return lastBody()
}

function lastBody(): Body {
  expect(bodies).toHaveLength(1)
  return bodies[0]!
}

beforeEach(() => {
  bodies = []
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
