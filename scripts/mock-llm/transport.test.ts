import { APICallError, tool, wrapLanguageModel, type ToolSet } from 'ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { fetchModelCatalog, parseStructured, replyStopOf } from '@/lib/ai'
import type { JsonSchema } from '@/lib/ai'
import { jsonResponseFormatMiddleware, promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { createProviderModel } from '@/lib/ai/providers'
import { recognizeOverflow } from '@/lib/ai/transport/classify-provider-error'
import { runProviderCall, streamProviderCall } from '@/lib/ai/transport/provider-call'
import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from '@/lib/piggyback'
import { fallbackClassifierSchema } from '@/lib/pipeline'

import { mockUsage, toolStepCompletionText, type MockToolStep } from './respond/wire'
import { startMockServer, type MockServer } from './server'

// The seam the other suites stop short of: the app's own provider construction
// and transport (createProviderModel -> @ai-sdk/openai-compatible ->
// createFetchWithCapture) talking to this server, rather than a hand-built
// fetch. A wire-format regression that the raw-HTTP tests would accept but the
// SDK would choke on fails here.

let mock: MockServer

beforeAll(async () => {
  mock = await startMockServer(0, { persist: false })
})

afterAll(async () => {
  await mock.close()
})

const provider = (): Parameters<typeof createProviderModel>[0] => ({
  id: 'prov_probe',
  type: 'openai-compatible',
  displayName: 'Mock',
  apiKey: '',
  favoriteModelIds: [],
  endpoint: mock.url,
})

/** A structured call wrapped the way lib/ai wraps it. */
function classifierModel(): Parameters<typeof runProviderCall>[0]['model'] {
  return wrapLanguageModel({
    model: createProviderModel(provider(), 'seed/narrative') as Parameters<
      typeof wrapLanguageModel
    >[0]['model'],
    middleware: [
      jsonResponseFormatMiddleware(z.toJSONSchema(fallbackClassifierSchema) as JsonSchema),
      promptSchemaMiddleware(),
    ],
  })
}

// What each shape's message says, as recognizeOverflow hands it on verbatim.
const OVERFLOW_PHRASE = {
  'overflow-llamacpp': 'exceeds the available context size',
  'overflow-openai': 'maximum context length',
} as const

describe('the app transport against the mock', () => {
  it('assembles a paced narrative stream back into prose and its trailing blocks', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 6 }
    lane.activeId = lane.responses.find((r) => r.name === 'With suggestions')?.id ?? lane.activeId

    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })

    let assembled = ''
    for await (const delta of stream.textStream) assembled += delta

    expect(stripTrailingBlocks(assembled).prose).toBe(
      'The rain does not stop. It only changes its mind about direction.',
    )

    const state = parseStateBlock(assembled)
    expect(state.failures).toEqual([])
    expect(state.block.worldTimeDelta).toBe(120)
    expect(state.block.summary).toBe('The storm shifts.')

    expect(parseSuggestionsBlock(assembled).items.map((i) => i.categoryRef)).toEqual([
      'cat1',
      'cat2',
      'cat3',
    ])
  })

  it('round-trips a structured call through the real middleware and parser', async () => {
    const model = classifierModel()

    const result = await runProviderCall({ model, prompt: 'Classify the turn.' })
    const value = parseStructured(result.text, fallbackClassifierSchema)

    expect(value).toMatchObject({ sceneEntities: [], worldTimeDelta: 0 })
    // The middleware's injected block is what the mock routed on: proof the
    // lane match works on a prompt the app built, not one the test built.
    expect(mock.ctx.log.list().find((e) => !e.streamed)?.lane).toBe('per-turn-classifier')
  })

  it('surfaces an injected HTTP failure to the transport as an error', async () => {
    mock.ctx.lane('per-turn-classifier').failure = { kind: 'http', status: 503, remaining: 1 }

    const model = classifierModel()

    await expect(runProviderCall({ model, prompt: 'Classify the turn.' })).rejects.toThrow()
  })

  // generation-pipeline.md → Cut-off replies rests on what the SDK reports for each ending.
  it.each([
    ['a whole reply', 'none', null],
    ['a length stop', 'length', 'length'],
    ['a stream with no finish frame', 'stream-cut', 'interrupted'],
  ] as const)('reads %s as the stop it was', async (_label, kind, stop) => {
    const lane = mock.ctx.lane('narrative')
    lane.failure = { kind, status: 500, remaining: kind === 'none' ? 0 : 1 }
    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })

    await stream.consumeStream()

    expect(replyStopOf(await stream.finishReason, await stream.rawFinishReason)).toBe(stop)
    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it("reports a lane's length failure as the SDK's finishReason on both paths", async () => {
    mock.ctx.lane('per-turn-classifier').failure = { kind: 'length', status: 500, remaining: 1 }
    const structured = await runProviderCall({
      model: classifierModel(),
      prompt: 'Classify the turn.',
    })
    expect(structured.finishReason).toBe('length')
    expect(() => JSON.parse(structured.text)).toThrow()

    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 6 }
    lane.failure = { kind: 'length', status: 500, remaining: 1 }
    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })
    let assembled = ''
    for await (const delta of stream.textStream) assembled += delta

    expect(await stream.finishReason).toBe('length')
    expect(assembled.length).toBeGreaterThan(0)
  })

  it("hands the catalog fetch every model's window", async () => {
    const entries = await fetchModelCatalog(provider())

    expect(entries.map((e) => e.id)).toEqual(['seed/narrative', 'mock/no-tagged-block'])
    expect(entries.map((e) => e.contextWindow)).toEqual([131072, 131072])
  })

  it('reports usage the SDK reads as input and output tokens, on both paths', async () => {
    mock.ctx.log.clear()
    const structured = await runProviderCall({
      model: classifierModel(),
      prompt: 'Classify the turn.',
    })
    const sent = mock.ctx.log.list()[0]
    const expected = mockUsage(sent?.prompt ?? '', structured.text)
    expect(expected.prompt_tokens).toBeGreaterThan(0)
    expect(structured.usage).toMatchObject({
      inputTokens: expected.prompt_tokens,
      outputTokens: expected.completion_tokens,
    })

    mock.ctx.lane('narrative').stream = { charsPerSecond: 100_000, chunkSize: 6 }
    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })
    let assembled = ''
    for await (const delta of stream.textStream) assembled += delta

    // 'Continue the scene.' is 4 o200k tokens; the stream reports usage only because the app's
    // provider asks for it (includeUsage).
    expect(await stream.usage).toMatchObject({
      inputTokens: 4,
      outputTokens: mockUsage('', assembled).completion_tokens,
    })
  })

  it.each(['overflow-llamacpp', 'overflow-openai'] as const)(
    'delivers a %s rejection as an APICallError the app recognizes, on both paths',
    async (kind) => {
      mock.ctx.lane('per-turn-classifier').failure = { kind, status: 500, remaining: 1 }
      const structured = await runProviderCall({
        model: classifierModel(),
        prompt: 'Classify the turn.',
      }).then(
        () => null,
        (error: unknown) => error,
      )
      expect(APICallError.isInstance(structured) ? structured.statusCode : null).toBe(400)
      expect(recognizeOverflow(structured)?.detail).toContain(OVERFLOW_PHRASE[kind])

      mock.ctx.lane('narrative').failure = { kind, status: 500, remaining: 1 }
      let streamed: unknown
      const stream = streamProviderCall({
        model: createProviderModel(provider(), 'seed/narrative'),
        prompt: 'Continue the scene.',
        onError: ({ error }) => {
          streamed = error
        },
      })
      let text = ''
      for await (const delta of stream.textStream) text += delta

      expect(text).toBe('')
      expect(APICallError.isInstance(streamed) ? streamed.statusCode : null).toBe(400)
      expect(recognizeOverflow(streamed)?.detail).toContain(OVERFLOW_PHRASE[kind])
    },
  )
})

const LOOKUP_LANE = 'tools:lookup'

const lookup = tool({
  description: 'Look something up in the story so far.',
  inputSchema: z.object({ query: z.string() }),
})
const note = tool({
  description: 'Write a note for later.',
  inputSchema: z.object({ text: z.string() }),
})

const LOOK_AT_THE_DOOR: MockToolStep = {
  reasoning: 'The door first.',
  toolCalls: [{ name: 'lookup', args: { query: 'the door' } }],
}

/** One step through the app's provider as generateToolStep sends it: tools with no execute. */
function sendToolStep(tools: ToolSet = { lookup }) {
  return runProviderCall({
    model: createProviderModel(provider(), 'seed/narrative'),
    prompt: 'Open the door.',
    tools,
  })
}

/** `steps` as the lookup lane's responses, the first active, no sequence and no failure. */
function cannedSteps(...steps: MockToolStep[]): void {
  const lane = mock.ctx.lane(LOOKUP_LANE)
  lane.mode = 'mock'
  lane.responses = steps.map((value, i) => ({ id: `r_step_${i}`, name: `Step ${i}`, value }))
  lane.activeId = lane.responses[0]?.id ?? null
  lane.sequence = { enabled: false, ids: lane.responses.map((r) => r.id), cursor: 0, loop: true }
  lane.failure = { kind: 'none', status: 500, remaining: 0 }
}

describe('tool lanes through the app transport', () => {
  it("answers a canned step's calls and reasoning, and logs the step it served", async () => {
    cannedSteps(LOOK_AT_THE_DOOR)
    mock.ctx.log.clear()

    const result = await sendToolStep()

    expect(result.finishReason).toBe('tool-calls')
    expect(result.toolCalls).toMatchObject([{ toolName: 'lookup', input: { query: 'the door' } }])
    expect(result.toolCalls[0]).not.toHaveProperty('invalid')
    expect(result.reasoningText).toBe('The door first.')
    expect(mock.ctx.log.list()[0]?.lane).toBe(LOOKUP_LANE)
    expect(mock.ctx.log.list()[0]?.served).toEqual(LOOK_AT_THE_DOOR)
    expect(mock.ctx.discovered.get(LOOKUP_LANE)).toMatchObject({ key: LOOKUP_LANE, block: null })
  })

  it('cycles a sequence, one step a call, back to the first', async () => {
    cannedSteps(LOOK_AT_THE_DOOR, { text: 'The door is locked.' })
    mock.ctx.lane(LOOKUP_LANE).sequence.enabled = true

    const replies: { finish: string; calls: string[]; text: string }[] = []
    for (let call = 0; call < 3; call += 1) {
      const result = await sendToolStep()
      replies.push({
        finish: result.finishReason,
        calls: result.toolCalls.map((c) => c.toolName),
        text: result.text,
      })
    }

    expect(replies).toEqual([
      { finish: 'tool-calls', calls: ['lookup'], text: '' },
      { finish: 'stop', calls: [], text: 'The door is locked.' },
      { finish: 'tool-calls', calls: ['lookup'], text: '' },
    ])
  })

  it('answers a tool lane nobody configured with no calls and stop, and lists it', async () => {
    const result = await sendToolStep({ lookup, note })

    expect(result.finishReason).toBe('stop')
    expect(result.toolCalls).toEqual([])
    expect(result.text).toBe('')
    expect(mock.ctx.discovered.get('tools:lookup+note')).toMatchObject({ block: null })
  })

  it.each(['malformed', 'stream-cut'] as const)(
    "%s cuts the first call's arguments in half, an invalid call, then answers whole",
    async (kind) => {
      cannedSteps({
        toolCalls: [
          { name: 'lookup', args: { query: 'the door' } },
          { name: 'lookup', args: { query: 'the key' } },
        ],
      })
      mock.ctx.lane(LOOKUP_LANE).failure = { kind, status: 500, remaining: 1 }

      const cut = await sendToolStep()

      // '{"query":"the door"}' is 20 characters; its first 10 don't parse.
      expect(cut.toolCalls).toMatchObject([
        { toolName: 'lookup', invalid: true, input: '{"query":"' },
        { toolName: 'lookup', input: { query: 'the key' } },
      ])
      expect(cut.toolCalls[1]).not.toHaveProperty('invalid')

      const whole = await sendToolStep()

      expect(whole.toolCalls).toMatchObject([
        { input: { query: 'the door' } },
        { input: { query: 'the key' } },
      ])
    },
  )

  it('serves a step with no calls as it is under malformed', async () => {
    cannedSteps({ text: 'Nothing to look up.' })
    mock.ctx.lane(LOOKUP_LANE).failure = { kind: 'malformed', status: 500, remaining: 1 }

    const result = await sendToolStep()

    expect(result.text).toBe('Nothing to look up.')
    expect(result.finishReason).toBe('stop')
    expect(result.toolCalls).toEqual([])
  })

  it('ends a length reply with its calls whole', async () => {
    cannedSteps(LOOK_AT_THE_DOOR)
    mock.ctx.lane(LOOKUP_LANE).failure = { kind: 'length', status: 500, remaining: 1 }

    const result = await sendToolStep()

    expect(result.finishReason).toBe('length')
    expect(result.toolCalls).toMatchObject([{ toolName: 'lookup', input: { query: 'the door' } }])
    expect(result.toolCalls[0]).not.toHaveProperty('invalid')
    expect(result.response.body).toMatchObject({
      choices: [
        {
          finish_reason: 'length',
          message: {
            tool_calls: [{ function: { name: 'lookup', arguments: '{"query":"the door"}' } }],
          },
        },
      ],
    })
  })

  it("counts a tool lane's tool definitions in its prompt tokens, and the step in its reply", async () => {
    cannedSteps(LOOK_AT_THE_DOOR)
    mock.ctx.log.clear()

    const result = await sendToolStep()
    const prompt = mock.ctx.log.list()[0]?.prompt ?? ''

    expect(prompt).toContain('Look something up in the story so far.')
    expect(result.usage.inputTokens).toBe(mockUsage(prompt, '').prompt_tokens)
    expect(result.usage.outputTokens).toBe(
      mockUsage('', toolStepCompletionText(LOOK_AT_THE_DOOR)).completion_tokens,
    )
  })
})
