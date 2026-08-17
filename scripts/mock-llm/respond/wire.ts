// OpenAI-compatible wire frames. Mirrors the shapes e2e/harness/mock-llm.ts
// emits, which the real transport (lib/ai/transport) already consumes.

const CHUNK_BASE = {
  id: 'chatcmpl-mock',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'mock',
}

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
}

export const SSE_HEADERS = {
  ...CORS_HEADERS,
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
}

export function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

export function roleFrame(): string {
  return sse({
    ...CHUNK_BASE,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  })
}

export function contentFrame(content: string): string {
  return sse({ ...CHUNK_BASE, choices: [{ index: 0, delta: { content }, finish_reason: null }] })
}

export function stopFrames(): string {
  return (
    sse({ ...CHUNK_BASE, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
    'data: [DONE]\n\n'
  )
}

export function completionBody(content: string): string {
  return JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  })
}

export function errorBody(message: string): string {
  return JSON.stringify({ error: { message, type: 'mock_injected_failure' } })
}
