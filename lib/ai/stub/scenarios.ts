export type StubScenario =
  | 'happy'
  | 'malformed-json'
  | 'mid-stream-timeout'
  | 'refusal'
  | 'cancellation-respects'
  | 'tool-step'
  | 'tool-step-cut'

export const STUB_TOOL_NAME = 'lookup'
export const STUB_TOOL_INPUT = { query: 'the door' } as const
export const STUB_THINKING_SIGNATURE = 'stub-thinking-signature'

type AnthropicBlock = Record<string, unknown>

const JSON_HEADERS = { 'content-type': 'application/json' }

function anthropicReply(content: readonly AnthropicBlock[], stopReason: string): Response {
  return new Response(
    JSON.stringify({
      type: 'message',
      id: 'msg_stub',
      role: 'assistant',
      model: 'claude-3-haiku-20240307',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    }),
    { status: 200, headers: JSON_HEADERS },
  )
}

function anthropicJson(text: string, stopReason = 'end_turn'): Response {
  return anthropicReply([{ type: 'text', text }], stopReason)
}

function invalidRequest(message: string): Response {
  return new Response(
    JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }),
    { status: 400, headers: JSON_HEADERS },
  )
}

function hangUntilAbort(signal: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    if (signal?.aborted) {
      fail()
      return
    }
    signal?.addEventListener('abort', fail, { once: true })
  })
}

type SentMessage = { role?: unknown; content?: unknown }

function sentMessages(body: string): SentMessage[] {
  if (body === '') return []
  const { messages } = JSON.parse(body) as { messages?: unknown }
  return Array.isArray(messages) ? (messages as SentMessage[]) : []
}

function blocksOf(message: SentMessage | undefined): AnthropicBlock[] {
  return Array.isArray(message?.content) ? (message.content as AnthropicBlock[]) : []
}

// Anthropic refuses a tool result unless the assistant turn before it opens with its thinking
// block, signature intact: the one offline check that a step's response messages replay it.
function toolStepReply(body: string): Response {
  const messages = sentMessages(body)
  const resultAt = messages.findIndex(
    (message) =>
      message.role === 'user' && blocksOf(message).some((block) => block.type === 'tool_result'),
  )
  if (resultAt === -1) {
    return anthropicReply(
      [
        { type: 'thinking', thinking: 'Look before acting.', signature: STUB_THINKING_SIGNATURE },
        { type: 'tool_use', id: 'toolu_stub_1', name: STUB_TOOL_NAME, input: STUB_TOOL_INPUT },
      ],
      'tool_use',
    )
  }
  const [opening] = blocksOf(messages[resultAt - 1])
  if (opening?.type === 'thinking' && opening.signature === STUB_THINKING_SIGNATURE) {
    return anthropicJson('The door opens.')
  }
  return invalidRequest(
    'The assistant message before a tool_result must open with its thinking block, signature intact.',
  )
}

// Bodies are Anthropic-shaped so the real createAnthropic parse path runs.
export function makeScenarioFetch(scenario: StubScenario): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    switch (scenario) {
      case 'happy':
        return anthropicJson('{"reply":"hi"}')
      case 'malformed-json':
        return anthropicJson('{ not valid json')
      case 'refusal':
        return anthropicJson('{"refusal":true}', 'refusal')
      case 'mid-stream-timeout':
        return Promise.reject(new DOMException('stub provider timed out', 'TimeoutError'))
      case 'cancellation-respects':
        return hangUntilAbort(request.signal)
      case 'tool-step':
        return toolStepReply(await request.text())
      case 'tool-step-cut':
        return anthropicJson('The door', 'max_tokens')
      default:
        throw new Error(`Unknown stub scenario: ${String(scenario)}`)
    }
  }
}
