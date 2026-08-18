// OpenAI-compatible wire frames, and the socket write every sender pushes them
// through. Mirrors the shapes e2e/harness/mock-llm.ts emits, which the real
// transport (lib/ai/transport) already consumes.

import type { ServerResponse } from 'node:http'

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

// res.write returns false once the socket buffer is full; ignoring it lets a
// slow client build an unbounded backlog instead of pacing to its own speed.
// 'drain' never arrives on a socket the client dropped, so close and error
// settle the wait too — otherwise the send loop never returns.
export function write(res: ServerResponse, chunk: string): Promise<void> {
  return new Promise((resolve) => {
    if (res.destroyed || res.writableEnded) return resolve()
    if (res.write(chunk)) return resolve()
    const settle = (): void => {
      res.off('drain', settle)
      res.off('close', settle)
      res.off('error', settle)
      resolve()
    }
    res.once('drain', settle)
    res.once('close', settle)
    res.once('error', settle)
  })
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

// Non-injected callers pass their own type: a provider outage must not read as
// something the panel asked for.
export function errorBody(message: string, type = 'mock_injected_failure'): string {
  return JSON.stringify({ error: { message, type } })
}
