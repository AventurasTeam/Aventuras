import { describe, expect, it } from 'vitest'
import { aggregateStream, parseSse, parseStreamEvents } from './streamLog'

const summarize = (text: string, readFinished = true) =>
  aggregateStream(parseStreamEvents(text), readFinished)

describe('parseSse', () => {
  it('reads event names and data, whatever the line ending', () => {
    const text = 'event: a\r\ndata: {"n":1}\r\n\r\nevent: b\rdata: {"n":2}\r\r'
    expect(parseSse(text)).toEqual([
      { event: 'a', data: '{"n":1}' },
      { event: 'b', data: '{"n":2}' },
    ])
  })

  it('skips comments and joins multi-line data', () => {
    expect(parseSse(': keep-alive\n\ndata: one\ndata: two\n\n')).toEqual([
      { event: undefined, data: 'one\ntwo' },
    ])
  })

  it('keeps a last event that never got its blank line', () => {
    expect(parseSse('data: {"a":1}\n\ndata: {"b":')).toEqual([
      { event: undefined, data: '{"a":1}' },
      { event: undefined, data: '{"b":' },
    ])
  })

  it('strips only one space after the colon', () => {
    expect(parseSse('data:  padded\n\n')[0].data).toBe(' padded')
    expect(parseSse('data:tight\n\n')[0].data).toBe('tight')
  })
})

describe('parseStreamEvents', () => {
  it('parses payloads, marks [DONE], and keeps text that is not JSON', () => {
    expect(parseStreamEvents('data: {"a":1}\n\ndata: oops\n\ndata: [DONE]\n\n')).toEqual([
      { payload: { a: 1 } },
      { payload: 'oops' },
      { payload: undefined, done: true },
    ])
  })
})

const anthropicStart =
  'event: message_start\n' +
  'data: {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "content": [], "model": "claude-opus-5-5", "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 25, "output_tokens": 1}}}\n\n'

const anthropicToolStream =
  anthropicStart +
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'event: ping\ndata: {"type": "ping"}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Okay"}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", let\'s check"}}\n\n' +
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\":"}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" \\"San Francisco, CA\\"}"}}\n\n' +
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n'

const anthropicEnd =
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":89}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'

describe('aggregateStream: Anthropic', () => {
  it('rebuilds the message from a complete stream', () => {
    const summary = summarize(anthropicToolStream + anthropicEnd)

    expect(summary).toMatchObject({ format: 'anthropic', complete: true, eventCount: 13 })
    expect(summary.lastEvent).toBeUndefined()
    expect(summary.body).toEqual({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 25, output_tokens: 89 },
      content: [
        { type: 'text', text: "Okay, let's check" },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'get_weather',
          input: { location: 'San Francisco, CA' },
        },
      ],
    })
  })

  it('joins thinking deltas and keeps the signature', () => {
    const summary = summarize(
      anthropicStart +
        'data: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}\n\n' +
        'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "21"}}\n\n' +
        'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": " it is"}}\n\n' +
        'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "Eq"}}\n\n' +
        'data: {"type": "content_block_stop", "index": 0}\n\n' +
        anthropicEnd,
    )

    expect(summary.body).toMatchObject({
      content: [{ type: 'thinking', thinking: '21 it is', signature: 'Eq' }],
    })
  })

  it('shows what arrived from a stream cut off before message_stop', () => {
    const cut =
      anthropicStart +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The castle"}}\n\n'

    const summary = summarize(cut, false)

    expect(summary.complete).toBe(false)
    expect(summary.body).toMatchObject({ content: [{ type: 'text', text: 'The castle' }] })
    expect(summary.lastEvent).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'The castle' },
    })
  })

  it('keeps tool arguments cut off mid-JSON as text', () => {
    const summary = summarize(
      anthropicStart +
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"n","input":{}}}\n\n' +
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"loc"}}\n\n',
      false,
    )

    expect(summary.body).toMatchObject({ content: [{ type: 'tool_use', partial_json: '{"loc' }] })
  })

  it('reports an error event', () => {
    const summary = summarize(
      anthropicStart +
        'event: error\ndata: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}\n\n',
    )

    expect(summary).toMatchObject({ complete: false, error: 'Overloaded' })
  })
})

describe('aggregateStream: OpenAI Responses', () => {
  const created = {
    type: 'response.created',
    response: { id: 'resp_1', status: 'in_progress', model: 'gpt-5', output: [] },
  }
  const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')

  it('uses the response a completed stream carries', () => {
    const response = {
      id: 'resp_1',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'In a forest' }] }],
      usage: { output_tokens: 3 },
    }

    const summary = summarize(
      sse(
        created,
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'In' },
        { type: 'response.completed', response },
      ),
    )

    expect(summary).toMatchObject({ format: 'openai-responses', complete: true, body: response })
  })

  it('rebuilds the output of a stream cut off before completing', () => {
    const summary = summarize(
      sse(
        created,
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { id: 'msg_1', type: 'message' },
        },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'In a ' },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'forest' },
      ),
      false,
    )

    expect(summary.complete).toBe(false)
    expect(summary.body).toMatchObject({
      id: 'resp_1',
      output: [{ id: 'msg_1', content: [{ type: 'output_text', text: 'In a forest' }] }],
    })
    expect(summary.lastEvent).toMatchObject({ delta: 'forest' })
  })

  it('reports a failed response', () => {
    const summary = summarize(
      sse(created, {
        type: 'response.failed',
        response: {
          id: 'resp_1',
          status: 'failed',
          error: { code: 'server_error', message: 'boom' },
        },
      }),
    )

    expect(summary).toMatchObject({ complete: true, error: 'boom' })
  })

  it('reports an error event', () => {
    expect(summarize(sse(created, { type: 'error', message: 'rate limited' }))).toMatchObject({
      error: 'rate limited',
    })
  })
})

describe('aggregateStream: Chat Completions', () => {
  const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
    `data: ${JSON.stringify({ id: 'c1', model: 'm', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`

  it('joins deltas, parses tool arguments and keeps usage', () => {
    const summary = summarize(
      ': OPENROUTER PROCESSING\n\n' +
        chunk({ role: 'assistant', content: 'Hel' }) +
        chunk({ content: 'lo', reasoning_content: 'hm' }) +
        chunk({
          tool_calls: [{ index: 0, id: 'call_1', function: { name: 'f', arguments: '{"a"' } }],
        }) +
        chunk({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, 'tool_calls') +
        'data: {"id":"c1","model":"m","choices":[],"usage":{"total_tokens":9}}\n\n' +
        'data: [DONE]\n\n',
    )

    expect(summary).toMatchObject({ format: 'chat-completions', complete: true })
    expect(summary.body).toEqual({
      id: 'c1',
      model: 'm',
      usage: { total_tokens: 9 },
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: 'Hello',
            reasoning: 'hm',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'f', arguments: '{"a":1}', parsed_arguments: { a: 1 } },
              },
            ],
          },
        },
      ],
    })
  })

  it('is complete once every choice has finished, without a [DONE]', () => {
    expect(summarize(chunk({ content: 'hi' }, 'stop')).complete).toBe(true)
  })

  it('is incomplete when the stream stops before a finish reason', () => {
    const summary = summarize(chunk({ content: 'hi' }), false)

    expect(summary.complete).toBe(false)
    expect(summary.lastEvent).toMatchObject({ id: 'c1' })
  })

  it('reports a mid-stream error', () => {
    const summary = summarize(
      chunk({ content: 'hi' }) +
        'data: {"error":{"code":502,"message":"Provider disconnected"},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}\n\n',
    )

    expect(summary.error).toBe('Provider disconnected')
  })
})

describe('aggregateStream: Gemini', () => {
  const chunk = (parts: object[], extra: object = {}, candidate: object = {}) =>
    `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, ...candidate }], ...extra })}\r\n\r\n`

  it('joins text and thoughts and takes the last chunk metadata', () => {
    const summary = summarize(
      chunk([{ text: 'plan', thought: true }], { modelVersion: 'gemini-x' }) +
        chunk([{ text: 'Hello ' }]) +
        chunk(
          [{ text: 'world' }],
          { usageMetadata: { totalTokenCount: 7 }, responseId: 'r1' },
          { finishReason: 'STOP' },
        ),
    )

    expect(summary).toMatchObject({ format: 'gemini', complete: true })
    expect(summary.body).toEqual({
      responseId: 'r1',
      modelVersion: 'gemini-x',
      usageMetadata: { totalTokenCount: 7 },
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'plan', thought: true }, { text: 'Hello world' }],
          },
          finishReason: 'STOP',
        },
      ],
    })
  })

  it('is incomplete without a finish reason, and complete for a blocked prompt', () => {
    expect(summarize(chunk([{ text: 'Hel' }]), false).complete).toBe(false)
    expect(summarize('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n').complete).toBe(true)
  })
})

describe('aggregateStream: unknown', () => {
  it('lists the payloads of a stream in no known format', () => {
    const summary = summarize('data: {"a":1}\n\ndata: {"b":2}\n\n')

    expect(summary).toMatchObject({
      format: 'unknown',
      complete: true,
      eventCount: 2,
      body: [{ a: 1 }, { b: 2 }],
    })
  })

  it('treats a body with no events as complete when it was read to the end', () => {
    expect(summarize('just some text')).toMatchObject({
      format: 'unknown',
      complete: true,
      eventCount: 0,
      error: undefined,
    })
  })

  it('is incomplete only when the read itself failed', () => {
    expect(summarize('data: {"a":1}\n\n', false).complete).toBe(false)
  })

  it('surfaces an error payload', () => {
    expect(summarize('data: {"error":{"message":"nope"}}\n\n').error).toBe('nope')
  })
})
