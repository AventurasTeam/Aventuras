import { createConnection } from 'node:net'

import type { ModelMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { z } from 'zod'

import {
  generateToolStep,
  type ResolveModelConfig,
  type ToolStep,
  type ToolStepResult,
  type ToolStepTool,
} from '@/lib/ai'
import { resetTestProviders, setTestProviders } from '@/lib/ai/stub/test-provider-registry'
import { TRUNCATION_RATIO } from '@/lib/ai/truncation-check'
import type { ProviderInstance } from '@/lib/db'
import { logger, type Logger } from '@/lib/diagnostics'

import { harnessPerTest, provider, structuredCall } from './harness-calls'
import { toolLaneKey } from './routing'
import {
  EXAMPLES,
  mockUsage,
  promptOf,
  type MockLlm,
  type MockRequest,
} from '../../e2e/harness/mock-llm'

// generateToolStep through the app's own provider to the harness, so what a spec scripts is what
// @ai-sdk/openai-compatible reads back.

const TOOLS = {
  read_row: { description: 'Read a row by its id.', inputSchema: z.object({ id: z.string() }) },
  write_row: {
    description: 'Set one field of a row.',
    inputSchema: z.object({ id: z.string(), field: z.string(), value: z.string() }),
  },
} satisfies Record<string, ToolStepTool>
const NAMES = Object.keys(TOOLS)
const LANE = toolLaneKey(NAMES)

const HALVES = { system: 'You close chapters.', user: 'Close the chapter. Start from row c7.' }

const started = harnessPerTest()

let warn: MockInstance<Logger['warn']>
let debug: MockInstance<Logger['debug']>

beforeEach(() => {
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  resetTestProviders()
  warn.mockRestore()
  debug.mockRestore()
})

/** Registers the harness as the app's provider and assigns `lore-mgmt` a profile on it. */
function registerHarness(llm: MockLlm): ResolveModelConfig {
  const harness = provider(llm)
  setTestProviders([harness])
  return {
    providers: [harness as ProviderInstance],
    profiles: [
      {
        id: 'prof_close',
        kind: 'agent',
        name: 'Close',
        modelRef: { providerId: harness.id, modelId: 'mock' },
      },
    ],
    assignments: { 'lore-mgmt': 'prof_close' },
  }
}

function step(
  config: ResolveModelConfig,
  messages: readonly ModelMessage[] = [],
  opts: { firstCall?: boolean; tools?: Readonly<Record<string, ToolStepTool>> } = {},
): Promise<ToolStepResult> {
  return generateToolStep(
    'lore-mgmt',
    {
      prompt: HALVES,
      messages,
      tools: opts.tools ?? TOOLS,
      firstCall: opts.firstCall ?? true,
    },
    config,
    new AbortController().signal,
    { actionId: null },
  )
}

function okStep(result: ToolStepResult): ToolStep {
  if (result.status !== 'ok') throw new Error(`expected an ok step: ${JSON.stringify(result)}`)
  return result.step
}

/** The step's messages, then an answer for each of its calls: what the next step sends. */
function answered(previous: ToolStep): ModelMessage[] {
  return [
    ...previous.responseMessages,
    {
      role: 'tool',
      content: previous.calls.map((call) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: 'text' as const, value: 'ok' },
      })),
    },
  ]
}

const callsOf = (s: ToolStep) => s.calls.map(({ toolName, input }) => ({ toolName, input }))

const readRow = (id: string) => ({ toolCalls: [{ name: 'read_row', args: { id } }] })

async function structuredReply(response: Promise<Response>): Promise<unknown> {
  const body = (await (await response).json()) as { choices: { message: { content: string } }[] }
  return JSON.parse(body.choices[0].message.content)
}

/** Whether the harness accepts a fresh connection; a pooled keep-alive socket can't answer. */
function accepting(llm: MockLlm): Promise<boolean> {
  const { hostname, port } = new URL(llm.url)
  return new Promise((resolve) => {
    const socket = createConnection({ host: hostname, port: Number(port) })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

describe('startMockLlm — tool lanes', () => {
  it('answers queued steps in order across two conversations', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.setToolSteps(NAMES, [
      { toolCalls: [{ name: 'read_row', args: { id: 'c1' } }] },
      { toolCalls: [{ name: 'read_row', args: { id: 'c2' } }] },
      { toolCalls: [{ name: 'write_row', args: { id: 'c1', field: 'status', value: 'gone' } }] },
    ])

    const first = okStep(await step(config))
    const other = okStep(await step(config))
    const second = okStep(await step(config, answered(first)))

    expect(callsOf(first)).toEqual([{ toolName: 'read_row', input: { id: 'c1' } }])
    expect(callsOf(other)).toEqual([{ toolName: 'read_row', input: { id: 'c2' } }])
    expect(callsOf(second)).toEqual([
      { toolName: 'write_row', input: { id: 'c1', field: 'status', value: 'gone' } },
    ])
    expect(first.finishReason).toBe('tool-calls')
    expect(llm.requests.map((r) => r.agent)).toEqual([LANE, LANE, LANE])
  })

  it('keys the queue on the tool names, in any order', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.setToolSteps([...NAMES].reverse(), [{ text: 'Done.' }])

    expect(okStep(await step(config)).text).toBe('Done.')
  })

  it('replaces the queue on a second setToolSteps', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.setToolSteps(NAMES, [{ text: 'First.' }])
    llm.setToolSteps(NAMES, [{ text: 'Second.' }])

    expect(okStep(await step(config)).text).toBe('Second.')
    expect(okStep(await step(config)).text).toBe('')
  })

  it('calls a function step with the request it answers', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    const seen: MockRequest[] = []
    llm.setToolSteps(NAMES, [
      (request) => {
        seen.push(request)
        const [, id = 'none'] = /row (\w+)\./.exec(promptOf(request)) ?? []
        return { toolCalls: [{ name: 'read_row', args: { id } }] }
      },
    ])

    const result = okStep(await step(config))

    expect(callsOf(result)).toEqual([{ toolName: 'read_row', input: { id: 'c7' } }])
    expect(seen).toEqual([llm.requests[0]])
    expect(seen[0]).toMatchObject({ streamed: false, agent: LANE })
  })

  it('answers an unscripted lane with no calls and stop', async () => {
    const llm = await started()
    const config = registerHarness(llm)

    const result = okStep(await step(config))

    expect(result).toMatchObject({ calls: [], invalidCalls: [], text: '', finishReason: 'stop' })
  })

  it('gives a held call the step queued by its release', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.holdNextStructured(LANE)
    const held = step(config)
    await vi.waitFor(() => expect(llm.requests.map((r) => r.agent)).toEqual([LANE]))

    llm.setToolSteps(NAMES, [{ toolCalls: [{ name: 'read_row', args: { id: 'c3' } }] }])
    llm.releaseStructured()

    expect(callsOf(okStep(await held))).toEqual([{ toolName: 'read_row', input: { id: 'c3' } }])
  })

  it('cuts the next call without taking its step, so the retry gets it', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.setToolSteps(NAMES, [{ toolCalls: [{ name: 'read_row', args: { id: 'c1' } }] }])
    llm.cutNextStructured(LANE, 'I will read the r')

    const result = await step(config)

    expect(result).toMatchObject({ status: 'ok', recoverable: [{ tier: 'reply-cut-off' }] })
    expect(callsOf(okStep(result))).toEqual([{ toolName: 'read_row', input: { id: 'c1' } }])
    expect(llm.requests.map((r) => r.agent)).toEqual([LANE, LANE])
  })

  it('sends the cut text verbatim with finish_reason length', async () => {
    const llm = await started()
    llm.cutNextStructured(LANE, 'I will read the r')

    const response = await fetch(`${llm.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mock',
        messages: [{ role: 'user', content: 'Close the chapter.' }],
        tools: NAMES.map((name) => ({ type: 'function', function: { name, parameters: {} } })),
      }),
    })
    const [choice] = ((await response.json()) as { choices: unknown[] }).choices

    expect(choice).toMatchObject({
      message: { content: 'I will read the r' },
      finish_reason: 'length',
    })
    expect(choice).not.toHaveProperty('message.tool_calls')
  })

  it('rejects the next call with an overflow, leaving the queued step for the call after', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.setToolSteps(NAMES, [{ text: 'After the overflow.' }])
    llm.overflowNextStructured(LANE)

    const stopped = await step(config, [], { firstCall: false })
    const next = await step(config, [], { firstCall: false })

    expect(stopped).toMatchObject({
      status: 'stopped',
      reason: 'window',
      failure: { detectedBy: 'provider' },
    })
    expect(okStep(next).text).toBe('After the overflow.')
    expect(llm.requests.map((r) => r.agent)).toEqual([LANE, LANE])
  })

  it("sends a step's reasoning back as reasoning_content on the next request", async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.setToolSteps(NAMES, [
      {
        reasoning: 'Kael first; the ledger can wait.',
        toolCalls: [{ name: 'read_row', args: { id: 'c1' } }],
      },
      { text: 'Done.' },
    ])

    const first = okStep(await step(config))
    okStep(await step(config, answered(first)))

    const sent = llm.requests[1]?.body.messages as Record<string, unknown>[]
    expect(sent.find((m) => m.role === 'assistant')).toMatchObject({
      reasoning_content: 'Kael first; the ledger can wait.',
      tool_calls: [{ function: { name: 'read_row', arguments: '{"id":"c1"}' } }],
    })
  })

  // architecture.md → Truncation cross-check: the estimate counts the tool definitions, so the
  // mock's count must too, or a short prompt with many tools reads as truncated.
  it('counts the tool definitions in its usage, so six tools on a short prompt raise no warning', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    const six = Object.fromEntries(
      ['search_world', 'read_row', 'read_turns', 'write_row', 'merge_rows', 'end_task'].map(
        (name) => [
          name,
          {
            description: `The ${name.replace('_', ' ')} tool: it names the row it acts on and the turns it cites.`,
            inputSchema: z.object({ id: z.string(), turns: z.array(z.string()), why: z.string() }),
          },
        ],
      ),
    )

    okStep(await step(config, [], { tools: six }))

    const ratio = debug.mock.calls.find(([kind]) => kind === 'provider.input_ratio')?.[1] as
      | { estimate: number; ratio: number }
      | undefined
    expect(ratio?.ratio).toBeGreaterThanOrEqual(TRUNCATION_RATIO)
    // Without the definitions the mock's count would sit under the threshold.
    const messagesOnly = mockUsage(promptOf(llm.requests[0]!), '').prompt_tokens
    expect(messagesOnly).toBeLessThan(TRUNCATION_RATIO * (ratio?.estimate ?? 0))
    expect(warn.mock.calls.map(([kind]) => kind)).not.toContain(
      'provider.prompt_truncation_suspected',
    )
  })
  it('holds one call: the next on the lane answers at once', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.holdNextStructured(LANE)
    const held = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))

    expect(okStep(await step(config))).toMatchObject({ calls: [], finishReason: 'stop' })

    llm.setToolSteps(NAMES, [readRow('c3')])
    llm.releaseStructured()
    expect(callsOf(okStep(await held))).toEqual([{ toolName: 'read_row', input: { id: 'c3' } }])
  })

  it('lets a tool call past a hold armed for a shape, which keeps it for its own', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.setToolSteps(NAMES, [{ text: 'Not held.' }])
    llm.holdNextStructured('periodic-classifier')

    expect(okStep(await step(config)).text).toBe('Not held.')

    const held = structuredCall(llm, 'periodic-classifier')
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    llm.setStructured('periodic-classifier', { marker: 'set after arrival' })
    llm.releaseStructured()
    expect(await structuredReply(held)).toEqual({ marker: 'set after arrival' })
  })

  it('lets a structured call past a hold armed for a lane, which keeps it for its own', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.holdNextStructured(LANE)

    expect(await structuredReply(structuredCall(llm, 'periodic-classifier'))).toEqual(
      EXAMPLES['periodic-classifier'],
    )

    const held = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    llm.setToolSteps(NAMES, [readRow('c4')])
    llm.releaseStructured()
    expect(callsOf(okStep(await held))).toEqual([{ toolName: 'read_row', input: { id: 'c4' } }])
  })

  it('answers an armed overflow before a hold, which stays for the next call', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.overflowNextStructured(LANE)
    llm.holdNextStructured(LANE)

    expect(await step(config, [], { firstCall: false })).toMatchObject({
      status: 'stopped',
      reason: 'window',
    })

    const held = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    llm.setToolSteps(NAMES, [readRow('c5')])
    llm.releaseStructured()
    expect(callsOf(okStep(await held))).toEqual([{ toolName: 'read_row', input: { id: 'c5' } }])
  })

  // The function step runs at release: answered first, the structured call reads no override.
  it('releases held structured and tool calls in arrival order', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.holdNextStructured('periodic-classifier')
    const structured = structuredCall(llm, 'periodic-classifier')
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))
    llm.holdNextStructured(LANE)
    const firstTool = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    llm.holdNextStructured(LANE)
    const secondTool = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(3))

    llm.setToolSteps(NAMES, [
      () => {
        llm.setStructured('periodic-classifier', { marker: 'set by the first tool step' })
        return readRow('c1')
      },
      readRow('c2'),
    ])
    llm.releaseStructured()

    expect(await structuredReply(structured)).toEqual(EXAMPLES['periodic-classifier'])
    expect(callsOf(okStep(await firstTool))).toEqual([
      { toolName: 'read_row', input: { id: 'c1' } },
    ])
    expect(callsOf(okStep(await secondTool))).toEqual([
      { toolName: 'read_row', input: { id: 'c2' } },
    ])
  })

  // An unanswered request keeps its connection open, and server.close() waits on it.
  it('answers a tool call still held when the server closes', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.holdNextStructured(LANE)
    const held = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))
    llm.setToolSteps(NAMES, [readRow('c6')])

    await llm.close()

    expect(callsOf(okStep(await held))).toEqual([{ toolName: 'read_row', input: { id: 'c6' } }])
  })

  it('fails a call whose step has args JSON cannot hold, and still closes', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.holdNextStructured(LANE)
    const held = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))
    llm.setToolSteps(NAMES, [{ toolCalls: [{ name: 'read_row', args: { id: 7n } }] }])

    await expect(llm.close()).rejects.toThrow('BigInt')

    expect(await accepting(llm)).toBe(false)
    const failed = await held
    expect(failed).toMatchObject({
      status: 'failed',
      error: { tier: 'provider', reason: 'unknown' },
    })
    expect(JSON.stringify(failed)).toContain('mock harness: a scripted step threw:')
  })

  it('fails a call whose function step throws, answers the rest, and still closes', async () => {
    const llm = await started()
    const config = registerHarness(llm)
    llm.holdNextStructured(LANE)
    const throwing = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))
    llm.holdNextStructured(LANE)
    const after = step(config)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    llm.setToolSteps(NAMES, [
      () => {
        throw new Error('the spec broke')
      },
      { text: 'Answered anyway.' },
    ])

    await expect(llm.close()).rejects.toThrow('the spec broke')

    expect(await accepting(llm)).toBe(false)
    const failed = await throwing
    expect(failed).toMatchObject({
      status: 'failed',
      error: { tier: 'provider', reason: 'unknown' },
    })
    expect(failed).not.toHaveProperty('error.possibleCapabilityMismatch')
    expect(JSON.stringify(failed)).toContain('mock harness: a scripted step threw: the spec broke')
    expect(okStep(await after).text).toBe('Answered anyway.')
    expect(llm.requests).toHaveLength(2)
  })
})
