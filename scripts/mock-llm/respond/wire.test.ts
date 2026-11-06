import { describe, expect, it } from 'vitest'

import {
  completionBody,
  toolStepBody,
  toolStepCompletionText,
  toolStepFinish,
  type MockToolStep,
} from './wire'

type WireCall = { id: string; type: string; function: { name: string; arguments: string } }
type WireChoice = {
  message: { role: string; content: string; reasoning_content?: string; tool_calls?: WireCall[] }
  finish_reason: string
}

function choiceOf(body: string): WireChoice {
  return (JSON.parse(body) as { choices: WireChoice[] }).choices[0]
}

const USAGE = { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }

describe('completionBody', () => {
  // Every structured reply in the E2E suite goes out through this envelope.
  it('renders a text completion byte for byte', () => {
    expect(completionBody('{}', 'length', USAGE)).toBe(
      '{"id":"chatcmpl-mock","object":"chat.completion","created":0,"model":"mock","choices":[{"index":0,"message":{"role":"assistant","content":"{}"},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
    )
  })
})

describe('toolStepBody', () => {
  it('renders each call as a function call, an object args as JSON and a string args verbatim', () => {
    const choice = choiceOf(
      toolStepBody({
        toolCalls: [
          { name: 'read_row', args: { id: 'c1' } },
          { name: 'write_row', args: '{"id": "c1", "field' },
        ],
      }),
    )

    expect(choice.message.content).toBe('')
    expect(choice.message).not.toHaveProperty('reasoning_content')
    expect(choice.message.tool_calls?.map((call) => [call.type, call.function])).toEqual([
      ['function', { name: 'read_row', arguments: '{"id":"c1"}' }],
      ['function', { name: 'write_row', arguments: '{"id": "c1", "field' }],
    ])
    expect(choice.finish_reason).toBe('tool_calls')
  })

  it('gives every call its own call_ id', () => {
    const calls = choiceOf(
      toolStepBody({
        toolCalls: [
          { name: 'read_row', args: { id: 'c1' } },
          { name: 'read_row', args: { id: 'c2' } },
        ],
      }),
    ).message.tool_calls
    const ids = calls?.map((call) => call.id) ?? []

    expect(ids).toHaveLength(2)
    for (const id of ids) expect(id).toMatch(/^call_[0-9a-f]+$/)
    expect(new Set(ids).size).toBe(2)
  })

  it('sends a call with no args as an empty object', () => {
    const choice = choiceOf(toolStepBody({ toolCalls: [{ name: 'end_task', args: undefined }] }))

    expect(choice.message.tool_calls?.[0]?.function).toEqual({ name: 'end_task', arguments: '{}' })
  })

  it('carries the text and the reasoning, with no tool_calls when there are no calls', () => {
    const choice = choiceOf(
      toolStepBody({ text: 'Nothing to change.', reasoning: 'All rows hold.' }),
    )

    expect(choice.message).toEqual({
      role: 'assistant',
      content: 'Nothing to change.',
      reasoning_content: 'All rows hold.',
    })
    expect(choice.finish_reason).toBe('stop')
  })

  it('answers an empty step with an empty message and stop', () => {
    const choice = choiceOf(toolStepBody({}))

    expect(choice.message).toEqual({ role: 'assistant', content: '' })
    expect(choice.finish_reason).toBe('stop')
  })

  it.each(['stop', 'length'] as const)(
    'sends an explicit %s beside whole calls',
    (finishReason) => {
      const choice = choiceOf(
        toolStepBody({ toolCalls: [{ name: 'read_row', args: { id: 'c1' } }], finishReason }),
      )

      expect(choice.finish_reason).toBe(finishReason)
      expect(choice.message.tool_calls?.[0]?.function.arguments).toBe('{"id":"c1"}')
    },
  )

  it('reports usage when given, and none when not', () => {
    expect(JSON.parse(toolStepBody({}, USAGE))).toMatchObject({ usage: USAGE })
    expect(JSON.parse(toolStepBody({}))).not.toHaveProperty('usage')
  })
})

describe('toolStepFinish', () => {
  it.each<[string, MockToolStep, string]>([
    ['calls and no finish', { toolCalls: [{ name: 'read_row', args: {} }] }, 'tool_calls'],
    ['an empty call list', { toolCalls: [] }, 'stop'],
    ['text alone', { text: 'Done.' }, 'stop'],
    ['an explicit finish', { text: 'Do', finishReason: 'content_filter' }, 'content_filter'],
  ])('reads %s', (_label, step, finish) => {
    expect(toolStepFinish(step)).toBe(finish)
  })
})

describe('toolStepCompletionText', () => {
  it('holds the text, the reasoning, and each call name with its args as sent', () => {
    const text = toolStepCompletionText({
      text: 'Reading first.',
      reasoning: 'Kael before the ledger.',
      toolCalls: [
        { name: 'read_row', args: { id: 'c1' } },
        { name: 'write_row', args: '{"id":' },
      ],
    })

    for (const part of [
      'Reading first.',
      'Kael before the ledger.',
      'read_row',
      '{"id":"c1"}',
      'write_row',
      '{"id":',
    ])
      expect(text).toContain(part)
  })

  it('is empty for an empty step', () => {
    expect(toolStepCompletionText({})).toBe('')
  })
})
