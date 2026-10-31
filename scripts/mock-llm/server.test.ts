import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from '@/lib/piggyback'
import { fallbackClassifierSchema } from '@/lib/pipeline'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { labeledPromptOutputSchema } from '@/lib/wizard'

import { firstHalf } from './completions'
import { collectSseContent } from './passthrough'
import { mockUsage, overflowBody, overflowCounts } from './respond/wire'
import { promptText } from './routing'
import { startMockServer, type MockServer } from './server'

let mock: MockServer

beforeAll(async () => {
  mock = await startMockServer(0, { persist: false })
})

afterAll(async () => {
  await mock.close()
})

const base = (): string => mock.url.replace(/\/v1$/, '')

async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${mock.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
}

/** The first log entry to land, however long the handler's own delay runs. */
async function waitForEntry(): Promise<{ outcome: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [entry] = mock.ctx.log.list()
    if (entry) return entry
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('no log entry arrived')
}

/** The app's auto-path request for `schema`; a blank system half leaves the contract as system. */
function structuredRequest(
  schema: z.ZodType,
  text = 'Classify the turn.',
): Record<string, unknown> {
  const block = schemaToTypeScriptBlock(z.toJSONSchema(schema) as JsonSchema)
  return {
    model: 'seed/narrative',
    messages: [
      {
        role: 'system',
        content: `Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:\n\n${block}`,
      },
      {
        role: 'user',
        content: `${text}\n\nOutput ONLY the JSON object, no other text or markdown.`,
      },
    ],
  }
}

async function narrativeText(response: Response): Promise<string> {
  return collectSseContent(await response.text())
}

async function structuredReply(): Promise<{ content: string; finishReason: string }> {
  const body = (await (await post(structuredRequest(fallbackClassifierSchema))).json()) as {
    choices: { message: { content: string }; finish_reason: string }[]
  }
  return {
    content: body.choices[0]?.message.content ?? '',
    finishReason: body.choices[0]?.finish_reason ?? '',
  }
}

describe('structured calls', () => {
  it("answers with the lane's active response, parseable by the app's schema", async () => {
    const response = await post(structuredRequest(fallbackClassifierSchema))
    expect(response.status).toBe(200)

    const body = (await response.json()) as { choices: { message: { content: string } }[] }
    const value = fallbackClassifierSchema.parse(JSON.parse(body.choices[0]?.message.content ?? ''))

    expect(value.worldTimeDelta).toBe(0)
    expect(value.sceneEntities).toEqual([])
  })

  it('answers a wizard call on the lane its own template names, with a reply that shape accepts', async () => {
    const prompt = renderTemplate(TEMPLATE_IDS.wizardTone, {
      definition: { setting: 'A city that flooded and stayed.', genre: {}, tone: {} },
      guidance: '',
    }).user
    const response = await post(structuredRequest(labeledPromptOutputSchema, prompt))

    const body = (await response.json()) as { choices: { message: { content: string } }[] }
    const value = labeledPromptOutputSchema.parse(
      JSON.parse(body.choices[0]?.message.content ?? ''),
    )
    expect(value.promptBody).not.toBe('')

    // Genre answers the same schema, so only the marker keeps the two apart.
    const [entry] = mock.ctx.log.list()
    expect(entry?.lane).toBe('wizard-tone')
  })

  it('answers {} for a shape nobody has configured, and opens a lane for it', async () => {
    const novel = z.object({ mood: z.string() })
    const response = await post(structuredRequest(novel))

    const body = (await response.json()) as { choices: { message: { content: string } }[] }
    expect(body.choices[0]?.message.content).toBe('{}')

    const discovered = [...mock.ctx.discovered.values()]
    const entry = discovered.find((d) => d.block?.includes('mood: string;'))
    expect(entry).toBeDefined()
    expect(mock.ctx.state.lanes[entry?.key ?? '']).toBeDefined()
    // A registered shape routes to its own lane and must never be discovered.
    expect(discovered.some((d) => d.key === 'per-turn-classifier')).toBe(false)
  })
})

describe('narrative streaming', () => {
  it('streams prose the reader can split from the trailing state block', async () => {
    mock.ctx.lane('narrative').stream = { charsPerSecond: 0, chunkSize: 6 }
    const response = await post({ model: 'seed/narrative', stream: true, messages: [] })

    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const content = await narrativeText(response)
    expect(stripTrailingBlocks(content).prose).toBe(
      'The blade rasps free of its sheath. Somewhere in the drowned city, a bell answers, and the rain leans closer to listen.',
    )

    const state = parseStateBlock(content)
    expect(state.failures).toEqual([])
    expect(state.block.worldTimeDelta).toBe(60)
  })

  it('delivers the same content in many frames when paced', async () => {
    mock.ctx.lane('narrative').stream = { charsPerSecond: 100_000, chunkSize: 6 }
    const raw = await (await post({ model: 'seed/narrative', stream: true, messages: [] })).text()

    const frames = raw.split('\n\n').filter((f) => f.startsWith('data:') && !f.includes('[DONE]'))
    expect(frames.length).toBeGreaterThan(5)
    expect(collectSseContent(raw)).toContain('The blade rasps free of its sheath.')
  })

  it('serves the suggestions block when the chosen response carries one', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 0, chunkSize: 6 }
    lane.activeId = lane.responses.find((r) => r.name === 'With suggestions')?.id ?? lane.activeId

    const content = await narrativeText(
      await post({ model: 'seed/narrative', stream: true, messages: [] }),
    )
    const suggestions = parseSuggestionsBlock(content)

    expect(suggestions.failed).toBe(false)
    expect(suggestions.items.map((i) => i.categoryRef)).toEqual(['cat1', 'cat2', 'cat3'])

    lane.activeId = lane.responses[0]?.id ?? null
  })
})

describe('failure injection', () => {
  it('returns the configured status and stops after the countdown', async () => {
    const lane = mock.ctx.lane('per-turn-classifier')
    lane.failure = { kind: 'http', status: 429, remaining: 1 }

    expect((await post(structuredRequest(fallbackClassifierSchema))).status).toBe(429)
    expect((await post(structuredRequest(fallbackClassifierSchema))).status).toBe(200)
  })

  it('serves a reply the app cannot repair into a valid object', async () => {
    const lane = mock.ctx.lane('per-turn-classifier')
    lane.failure = { kind: 'malformed', status: 500, remaining: 1 }

    const body = (await (await post(structuredRequest(fallbackClassifierSchema))).json()) as {
      choices: { message: { content: string } }[]
    }
    const raw = body.choices[0]?.message.content ?? ''

    expect(() => fallbackClassifierSchema.parse(JSON.parse(raw))).toThrow()
  })

  it('cuts a narrative stream short with no stop frame', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 6 }
    lane.failure = { kind: 'stream-cut', status: 500, remaining: 1 }

    const raw = await (await post({ model: 'seed/narrative', stream: true, messages: [] })).text()

    expect(raw).not.toContain('[DONE]')
    expect(raw).not.toContain('"finish_reason":"stop"')
    expect(collectSseContent(raw).length).toBeGreaterThan(0)

    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it('logs what a cut stream delivered, not what it was going to say', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 8 }
    lane.failure = { kind: 'stream-cut', status: 500, remaining: 1 }
    mock.ctx.log.clear()

    const text = await narrativeText(
      await post({ model: 'seed/narrative', stream: true, messages: [] }),
    )

    expect(text).not.toContain('<state>')
    expect(mock.ctx.log.list()[0]?.served).toBe(text)
    expect(mock.ctx.log.lastNarrativeHadState).toBe(false)

    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it("swaps a narrative's own <state> for a truncated one, so the parse has to recover", async () => {
    const lane = mock.ctx.lane('narrative')
    lane.failure = { kind: 'malformed', status: 500, remaining: 1 }

    const text = await narrativeText(
      await post({ model: 'seed/narrative', stream: true, messages: [] }),
    )

    expect(text.match(/<state>/g)).toHaveLength(1)
    expect(parseStateBlock(text).failures).not.toEqual([])

    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it('leaves a kind that alters a canned reply armed on a passthrough lane', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.mode = 'passthrough'
    lane.failure = { kind: 'malformed', status: 500, remaining: 1 }
    mock.ctx.log.clear()

    await post({ model: 'seed/narrative', stream: true, messages: [] })

    expect(lane.failure.remaining).toBe(1)
    expect(mock.ctx.log.list()[0]?.failureKind).toBeUndefined()

    lane.mode = 'mock'
    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it('still fails a passthrough lane on a kind no reply is needed for', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.mode = 'passthrough'
    lane.failure = { kind: 'http', status: 503, remaining: 1 }

    const response = await post({ model: 'seed/narrative', stream: true, messages: [] })

    expect(response.status).toBe(503)
    expect(lane.failure.remaining).toBe(0)

    lane.mode = 'mock'
    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it('sends no usage frame on a cut stream, even to a request that asked for it', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 6 }
    lane.failure = { kind: 'stream-cut', status: 500, remaining: 1 }

    const raw = await (
      await post({
        model: 'seed/narrative',
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'Continue the scene.' }],
      })
    ).text()

    expect(raw).not.toContain('"usage"')
    expect(collectSseContent(raw).length).toBeGreaterThan(0)
  })

  it('does not spend a sequence entry on a call it failed', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 0, chunkSize: 6 }
    lane.sequence = { enabled: true, ids: lane.responses.map((r) => r.id), cursor: 0, loop: true }
    lane.failure = { kind: 'http', status: 500, remaining: 1 }

    await post({ model: 'seed/narrative', stream: true, messages: [] })
    expect(lane.sequence.cursor).toBe(0)

    const content = await narrativeText(
      await post({ model: 'seed/narrative', stream: true, messages: [] }),
    )
    expect(content).toContain('The blade rasps free of its sheath.')
    expect(lane.sequence.cursor).toBe(1)

    lane.sequence.enabled = false
  })

  it('stops a structured reply halfway with finish_reason length, then answers whole again', async () => {
    const lane = mock.ctx.lane('per-turn-classifier')
    const whole = await structuredReply()
    expect(whole.finishReason).toBe('stop')
    lane.failure = { kind: 'length', status: 500, remaining: 1 }

    const cut = await structuredReply()

    expect(cut.finishReason).toBe('length')
    expect(cut.content).toBe(whole.content.slice(0, Math.floor(whole.content.length / 2)))
    expect(() => JSON.parse(cut.content)).toThrow()
    expect(await structuredReply()).toEqual(whole)
    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it.each([0, 100_000])(
    'stops a narrative stream halfway with finish_reason length and [DONE] (%i chars/s)',
    async (charsPerSecond) => {
      const lane = mock.ctx.lane('narrative')
      lane.stream = { charsPerSecond, chunkSize: 6 }
      const whole = await narrativeText(
        await post({ model: 'seed/narrative', stream: true, messages: [] }),
      )
      lane.failure = { kind: 'length', status: 500, remaining: 1 }

      const raw = await (await post({ model: 'seed/narrative', stream: true, messages: [] })).text()

      expect(collectSseContent(raw)).toBe(whole.slice(0, Math.floor(whole.length / 2)))
      expect(raw).toContain('"finish_reason":"length"')
      expect(raw).not.toContain('"finish_reason":"stop"')
      expect(raw).toContain('data: [DONE]')
      expect(lane.failure.remaining).toBe(0)
      lane.failure = { kind: 'none', status: 500, remaining: 0 }
    },
  )
  it.each([
    ['overflow-llamacpp', 'llamacpp'],
    ['overflow-openai', 'openai'],
  ] as const)(
    'answers %s with a 400 in that shape, whatever status the lane names, then answers again',
    async (kind, shape) => {
      mock.ctx.log.clear()
      const lane = mock.ctx.lane('per-turn-classifier')
      lane.failure = { kind, status: 503, remaining: 1 }
      const request = structuredRequest(fallbackClassifierSchema)

      const rejected = await post(request)

      expect(rejected.status).toBe(400)
      expect(rejected.headers.get('content-type')).toContain('application/json')
      expect(await rejected.text()).toBe(overflowBody(shape, overflowCounts(promptText(request))))
      expect(mock.ctx.log.list()[0]).toMatchObject({
        outcome: 'failed',
        failureKind: kind,
        status: 400,
      })
      expect((await post(request)).status).toBe(200)
    },
  )

  it('rejects a narrative call with an overflow 400 before any stream opens', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.failure = { kind: 'overflow-llamacpp', status: 500, remaining: 1 }

    const response = await post({ model: 'seed/narrative', stream: true, messages: [] })

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.text()).toContain('exceed_context_size_error')
    expect(lane.failure.remaining).toBe(0)
  })
})

describe('firstHalf', () => {
  it('keeps the floor of half the characters, and at least one', () => {
    expect(firstHalf('abcde')).toBe('ab')
    expect(firstHalf('abcd')).toBe('ab')
    expect(firstHalf('a')).toBe('a')
    expect(firstHalf('')).toBe('')
  })

  it('counts a character outside the BMP as one, never splitting its surrogate pair', () => {
    expect(firstHalf('ab😀cd')).toBe('ab')
    expect(firstHalf('😀')).toBe('😀')
  })
})

describe('wire helpers', () => {
  it('counts usage with o200k over the prompt and the reply', () => {
    expect(mockUsage('hello world', 'hi')).toEqual({
      prompt_tokens: 2,
      completion_tokens: 1,
      total_tokens: 3,
    })
    expect(mockUsage('', '')).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
  })

  // llama.cpp's body as its server sends it; OpenAI's, less its message's closing sentence.
  it("writes llama.cpp's and OpenAI's overflow bodies as those servers do", () => {
    expect(overflowBody('llamacpp', { prompt: 71834, window: 65536 })).toBe(
      '{"error":{"code":400,"message":"request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":71834,"n_ctx":65536}}',
    )
    expect(overflowBody('openai', { prompt: 130000, window: 128000 })).toBe(
      '{"error":{"message":"This model\'s maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.","type":"invalid_request_error","param":"messages","code":"context_length_exceeded"}}',
    )
  })

  it('puts an overflow at the counted prompt, over a window half its size', () => {
    expect(overflowCounts('hello world')).toEqual({ prompt: 2, window: 1 })
    expect(overflowCounts('')).toEqual({ prompt: 0, window: 1 })
  })
})

describe('client abort', () => {
  it('leaves the failure budget intact for a call nobody waited for', async () => {
    mock.ctx.log.clear()
    const lane = mock.ctx.lane('narrative')
    lane.delay = { ttfbMs: 300, jitterMs: 0 }
    lane.failure = { kind: 'http', status: 503, remaining: 1 }

    const abort = new AbortController()
    const inflight = post({ model: 'seed/narrative', stream: true, messages: [] }, abort.signal)
    await new Promise((resolve) => setTimeout(resolve, 50))
    abort.abort()
    await inflight.catch(() => null)

    // The handler is still sleeping out its TTFB; it logs when that finishes.
    const entry = await waitForEntry()
    expect(entry.outcome).toBe('aborted')
    // The whole point of the one-shot budget: it belongs to the next call that
    // is actually served, not to one that was abandoned before it was answered.
    expect(lane.failure.remaining).toBe(1)

    lane.delay = { ttfbMs: 0, jitterMs: 0 }
    expect((await post({ model: 'seed/narrative', stream: true, messages: [] })).status).toBe(503)
    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })
})

describe('catalog and control surface', () => {
  it('advertises the model id the seed pins taggedBlockReliable to', async () => {
    const body = (await (await fetch(`${mock.url}/models`)).json()) as { data: { id: string }[] }
    expect(body.data.map((m) => m.id)).toContain('seed/narrative')
  })

  it("publishes every model's window as meta.n_ctx, the field detection reads", async () => {
    const body = (await (await fetch(`${mock.url}/models`)).json()) as {
      data: { id: string; meta?: { n_ctx?: number } }[]
    }
    expect(body.data.map((m) => m.meta?.n_ctx)).toEqual([131072, 131072])
  })

  it('logs each call with its lane and the placeholders its prompt offered', async () => {
    mock.ctx.log.clear()
    await post({
      model: 'seed/narrative',
      messages: [
        {
          role: 'user',
          content:
            'Cast:\n[c1] Kael, sellsword\n[c2] Mira\n[lo1] The Drowning\nLocation: [l1] The Harbour',
        },
      ],
    })

    const entries = (await (await fetch(`${base()}/api/log`)).json()) as {
      lane: string
      placeholders: { ref: string; label: string }[]
    }[]

    expect(entries).toHaveLength(1)
    expect(entries[0]?.lane).toBe('unknown:no-schema')
    expect(entries[0]?.placeholders).toEqual([
      { ref: 'c1', label: 'Kael, sellsword' },
      { ref: 'c2', label: 'Mira' },
      { ref: 'lo1', label: 'The Drowning' },
      { ref: 'l1', label: 'The Harbour' },
    ])
  })

  it('reads the roster out of a real wizard prompt, whose cast rows are not bracketed', async () => {
    mock.ctx.log.clear()
    // The macro itself, not a transcription of it: the extractor has to track
    // whatever macro_wizard_opening_context actually renders.
    const prompt = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'adventure', genre: {}, tone: {} },
      leadEntityId: 'c1',
      lore: [],
      cast: [
        {
          id: 'c1',
          name: 'Kael Ashwater',
          kind: 'character',
          status: 'active',
          description: 'A diver.',
        },
        {
          id: 'l1',
          name: 'The Drowned Exchange',
          kind: 'location',
          status: 'active',
          description: '',
        },
        { id: 'c2', name: 'Verity Sould', kind: 'character', status: 'staged', description: '' },
      ],
      guidance: '',
    }).user
    await post({ model: 'seed/narrative', messages: [{ role: 'user', content: prompt }] })

    const entries = (await (await fetch(`${base()}/api/log`)).json()) as {
      placeholders: { ref: string; label: string }[]
    }[]

    // Staged rows are filtered out of the prompt by the macro, so the roster
    // the panel pins is exactly the one the reply may legally reference.
    expect(entries[0]?.placeholders).toEqual([
      { ref: 'c1', label: 'Kael Ashwater' },
      { ref: 'l1', label: 'The Drowned Exchange' },
    ])
  })

  it('keeps inline placeholders separate instead of folding them into one label', async () => {
    mock.ctx.log.clear()
    await post({
      model: 'seed/narrative',
      messages: [{ role: 'user', content: 'Present: [c1] Kael and [c2] Mira.' }],
    })

    const entries = (await (await fetch(`${base()}/api/log`)).json()) as {
      placeholders: { ref: string; label: string }[]
    }[]

    expect(entries[0]?.placeholders).toEqual([
      { ref: 'c1', label: 'Kael and' },
      { ref: 'c2', label: 'Mira.' },
    ])
  })
})

describe('lane PUT', () => {
  const put = (patch: unknown): Promise<Response> =>
    fetch(`${base()}/api/lanes/narrative`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })

  it('merges an object patch into its group, keeping the fields it leaves out', async () => {
    mock.ctx.lane('narrative').stream = { charsPerSecond: 40, chunkSize: 6 }
    expect((await put({ stream: { chunkSize: 9 } })).status).toBe(200)
    expect(mock.ctx.lane('narrative').stream).toEqual({ charsPerSecond: 40, chunkSize: 9 })
  })

  it('validates a patch that is no object as sent, refusing it', async () => {
    mock.ctx.lane('narrative').stream = { charsPerSecond: 40, chunkSize: 6 }
    expect((await put({ stream: 5 })).status).toBe(400)
    expect(mock.ctx.lane('narrative').stream).toEqual({ charsPerSecond: 40, chunkSize: 6 })
  })

  it('accepts the length failure kind', async () => {
    const response = await fetch(`${base()}/api/lanes/per-turn-classifier`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ failure: { kind: 'length', remaining: 1 } }),
    })

    expect(response.status).toBe(200)
    expect(mock.ctx.lane('per-turn-classifier').failure).toMatchObject({
      kind: 'length',
      remaining: 1,
    })
    mock.ctx.lane('per-turn-classifier').failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it('accepts both overflow failure kinds', async () => {
    for (const kind of ['overflow-llamacpp', 'overflow-openai'] as const) {
      const response = await fetch(`${base()}/api/lanes/per-turn-classifier`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ failure: { kind, remaining: 1 } }),
      })
      expect(response.status).toBe(200)
      expect(mock.ctx.lane('per-turn-classifier').failure).toMatchObject({ kind, remaining: 1 })
    }
    mock.ctx.lane('per-turn-classifier').failure = { kind: 'none', status: 500, remaining: 0 }
  })
})

describe('usage', () => {
  it('reports usage on a structured reply, counted over its prompt and its reply', async () => {
    const request = structuredRequest(fallbackClassifierSchema)
    const body = (await (await post(request)).json()) as {
      choices: { message: { content: string } }[]
      usage?: unknown
    }
    const content = body.choices[0]?.message.content ?? ''
    const expected = mockUsage(promptText(request), content)

    expect(expected.prompt_tokens).toBeGreaterThan(0)
    expect(body.usage).toEqual(expected)
  })

  it('streams usage before [DONE] only to a request that asks for it', async () => {
    mock.ctx.lane('narrative').stream = { charsPerSecond: 0, chunkSize: 6 }
    const messages = [{ role: 'user', content: 'Continue the scene.' }]

    const plain = await (await post({ model: 'seed/narrative', stream: true, messages })).text()
    expect(plain).not.toContain('"usage"')

    const raw = await (
      await post({
        model: 'seed/narrative',
        stream: true,
        stream_options: { include_usage: true },
        messages,
      })
    ).text()
    const frames = raw.split('\n\n').filter((frame) => frame.startsWith('data:'))
    expect(frames.at(-1)).toBe('data: [DONE]')
    expect(frames.at(-3)).toContain('"finish_reason":"stop"')
    const last = JSON.parse((frames.at(-2) ?? '').slice('data: '.length)) as {
      choices: unknown[]
      usage: unknown
    }
    expect(last.choices).toEqual([])
    expect(last.usage).toEqual(mockUsage('Continue the scene.', collectSseContent(raw)))
  })
})
