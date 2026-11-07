import { generateText, type ModelMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { ProviderInstance } from '@/lib/db'

import { getModel } from '../model'
import type { ResolveModelConfig } from '../resolve-model'
import { generateToolStep, type ToolStep, type ToolStepResult } from '../tool-step'
import { STUB_TOOL_INPUT, STUB_TOOL_NAME } from './scenarios'
import { resetTestProviders, setTestProviders } from './test-provider-registry'

const stub = {
  id: 'stub-1',
  type: 'stub' as const,
  displayName: 'Stub',
  apiKey: 'stub-key',
  favoriteModelIds: [] as string[],
}

function configFor(scenario: 'tool-step' | 'tool-step-cut'): ResolveModelConfig {
  return {
    providers: [stub as unknown as ProviderInstance],
    profiles: [
      {
        id: 'prof-stub',
        kind: 'agent',
        name: 'Stub',
        modelRef: { providerId: stub.id, modelId: scenario },
      },
    ],
    assignments: { 'lore-mgmt': 'prof-stub' },
  }
}

const TOOLS = {
  [STUB_TOOL_NAME]: {
    description: 'Look something up.',
    inputSchema: z.object({ query: z.string() }),
  },
}

function toolStep(
  messages: readonly ModelMessage[],
  scenario: 'tool-step' | 'tool-step-cut' = 'tool-step',
): Promise<ToolStepResult> {
  return generateToolStep(
    'lore-mgmt',
    {
      prompt: { system: 'You open doors.', user: 'Open the door.' },
      messages,
      tools: TOOLS,
      firstCall: messages.length === 0,
    },
    configFor(scenario),
    new AbortController().signal,
    { actionId: null },
  )
}

function okStep(result: ToolStepResult): ToolStep {
  if (result.status !== 'ok') throw new Error(`expected an ok step: ${JSON.stringify(result)}`)
  return result.step
}

function answer(step: ToolStep): ModelMessage {
  return {
    role: 'tool',
    content: step.calls.map((call) => ({
      type: 'tool-result' as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: 'text' as const, value: 'A heavy oak door.' },
    })),
  }
}

describe('stub provider', () => {
  afterEach(() => {
    resetTestProviders()
    vi.unstubAllGlobals()
  })

  it('happy scenario routes through the captured fetch and returns the canned reply', async () => {
    setTestProviders([stub])
    const { text } = await generateText({ model: getModel('stub-1', 'happy'), prompt: 'go' })
    expect(text).toBe('{"reply":"hi"}')
  })

  // memory/chapter-close.md → Conversations: the response messages go back as they are, so
  // @ai-sdk/anthropic replays the thinking block with its signature on the next step.
  it('tool-step replays the signed thinking block on the step after a call', async () => {
    setTestProviders([stub])

    const first = okStep(await toolStep([]))
    expect(first.calls).toEqual([
      { toolCallId: 'toolu_stub_1', toolName: STUB_TOOL_NAME, input: STUB_TOOL_INPUT },
    ])

    const second = okStep(await toolStep([...first.responseMessages, answer(first)]))
    expect(second).toMatchObject({ calls: [], text: 'The door opens.', finishReason: 'stop' })
  })

  it('tool-step refuses the next step when its thinking block is dropped', async () => {
    setTestProviders([stub])
    const first = okStep(await toolStep([]))
    const withoutReasoning = first.responseMessages.map((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? { ...message, content: message.content.filter((part) => part.type !== 'reasoning') }
        : message,
    )

    const refused = await toolStep([...withoutReasoning, answer(first)])

    expect(refused).toMatchObject({
      status: 'failed',
      error: { tier: 'provider', detail: expect.stringContaining('thinking block') },
    })
  })

  // The adapter clamps the step's 8k default to the stub model's 4096, and a real cut reports the
  // output it was allowed, so the cause reads max-output only against what the request sent.
  it('tool-step-cut stops the step after one retry, as a cut at the max output', async () => {
    setTestProviders([stub])

    const result = await toolStep([], 'tool-step-cut')

    const cut = {
      cause: 'max-output',
      outputTokens: 4096,
      maxOutput: 4096,
      providerId: stub.id,
      modelId: 'tool-step-cut',
    }
    expect(result).toMatchObject({
      status: 'stopped',
      reason: 'cut-off',
      failure: cut,
      recoverable: [{ tier: 'reply-cut-off', ...cut }],
    })
  })

  it('rejects stub creation in production builds', () => {
    vi.stubGlobal('__DEV__', false)
    setTestProviders([stub])
    expect(() => getModel('stub-1', 'happy')).toThrow(/production/)
  })
})
