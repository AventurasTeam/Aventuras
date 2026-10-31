// OpenAI-compatible frames, shared with e2e/harness/mock-llm.ts: a change here
// reaches the E2E suite; the real transport (lib/ai/transport) consumes them.

import type { IncomingMessage, ServerResponse } from 'node:http'

import { Tiktoken } from 'js-tiktoken/lite'
import o200kBase from 'js-tiktoken/ranks/o200k_base'

const CHUNK_BASE = {
  id: 'chatcmpl-mock',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'mock',
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
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

/** Each mock model's `meta.n_ctx` on /models, for window detection; far above any dev prompt. */
export const MOCK_CONTEXT_WINDOW = 131072

export type MockUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }
export type OverflowShape = 'llamacpp' | 'openai'

// countTokens' ranks and encode options (lib/retrieval/tokens.ts), so a reported count sits
// near the app's own estimate and the truncation cross-check reads a ratio near 1.
let encoder: Tiktoken | null = null

function countO200k(text: string): number {
  if (text === '') return 0
  encoder ??= new Tiktoken(o200kBase)
  return encoder.encode(text, [], []).length
}

/** The usage a server reports for `promptText` in and `content` out. */
export function mockUsage(promptText: string, content: string): MockUsage {
  const prompt = countO200k(promptText)
  const completion = countO200k(content)
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

/** OpenAI streams usage only to a request that asks with `stream_options.include_usage`. */
export function wantsStreamUsage(body: Record<string, unknown>): boolean {
  const options = body.stream_options as { include_usage?: unknown } | null | undefined
  return options?.include_usage === true
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

export type FinishReason = 'stop' | 'length'

/** The terminal frame, the usage frame when given, then [DONE]. */
export function stopFrames(finishReason: FinishReason = 'stop', usage?: MockUsage): string {
  return (
    sse({ ...CHUNK_BASE, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }) +
    (usage !== undefined ? usageFrame(usage) : '') +
    'data: [DONE]\n\n'
  )
}

/** The chunk OpenAI sends last under `include_usage`: no choices, the call's usage. */
export function usageFrame(usage: MockUsage): string {
  return sse({ ...CHUNK_BASE, choices: [], usage })
}

export function completionBody(
  content: string,
  finishReason: FinishReason = 'stop',
  usage?: MockUsage,
): string {
  return JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    ...(usage !== undefined ? { usage } : {}),
  })
}

// Non-injected callers pass their own type: a provider outage must not read as
// something the panel asked for.
export function errorBody(message: string, type = 'mock_injected_failure'): string {
  return JSON.stringify({ error: { message, type } })
}

/** llama.cpp's and OpenAI's own rejections of a prompt over the window. */
export function overflowBody(
  shape: OverflowShape,
  counts: { prompt: number; window: number },
): string {
  const { prompt, window } = counts
  if (shape === 'llamacpp') {
    return JSON.stringify({
      error: {
        code: 400,
        message: `request (${prompt} tokens) exceeds the available context size (${window} tokens), try increasing it`,
        type: 'exceed_context_size_error',
        n_prompt_tokens: prompt,
        n_ctx: window,
      },
    })
  }
  return JSON.stringify({
    error: {
      message: `This model's maximum context length is ${window} tokens. However, your messages resulted in ${prompt} tokens.`,
      type: 'invalid_request_error',
      param: 'messages',
      code: 'context_length_exceeded',
    },
  })
}

/** An overflow body's counts: the prompt as counted, over a window half its size. */
export function overflowCounts(promptText: string): { prompt: number; window: number } {
  const prompt = mockUsage(promptText, '').prompt_tokens
  return { prompt, window: Math.max(1, Math.floor(prompt / 2)) }
}
