import type { ServerResponse } from 'node:http'

import {
  CORS_HEADERS,
  SSE_HEADERS,
  errorBody,
  isFinishReason,
  write,
  type MockToolStep,
} from './respond/wire'
import { toolLaneOf } from './routing'
import type { Upstream } from './state'

export type PassthroughResult = {
  status: number
  /** Assembled assistant text — what record mode saves as a canned response. */
  content: string
  /** On a tool lane, the reply as a step; record mode saves this instead. */
  toolStep?: MockToolStep
  error?: string
}

function completionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/chat/completions`
}

/** Accumulates the assistant text carried by an OpenAI-compatible SSE buffer. */
export function collectSseContent(buffer: string): string {
  let content = ''
  for (const block of buffer.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data:'))
    if (line === undefined) continue
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    try {
      const parsed = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[]
      }
      content += parsed.choices?.[0]?.delta?.content ?? ''
    } catch {
      // The whole buffer is parsed at once, so this is a final frame the
      // upstream truncated; its text is simply not part of what was served.
    }
  }
  return content
}

function messageContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] }
    return parsed.choices?.[0]?.message?.content ?? ''
  } catch {
    return ''
  }
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

// Parsed so the panel edits it as JSON; kept as sent when it doesn't parse, or parses to a string,
// which would go back out without its quotes.
function recordedArgs(raw: string): unknown {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'string' ? raw : value
  } catch {
    return raw
  }
}

type CompletionChoice = {
  message?: {
    content?: unknown
    reasoning_content?: unknown
    reasoning?: unknown
    tool_calls?: unknown
  }
  finish_reason?: unknown
}

/** A non-streamed upstream reply as the step that replays it; null when it holds no message. */
export function toolStepOfCompletion(raw: string): MockToolStep | null {
  let choice: CompletionChoice | undefined
  try {
    choice = (JSON.parse(raw) as { choices?: CompletionChoice[] } | null)?.choices?.[0]
  } catch {
    return null
  }
  const message = choice?.message
  if (typeof message !== 'object' || message === null) return null

  const text = nonEmptyText(message.content)
  const reasoning = nonEmptyText(message.reasoning_content) ?? nonEmptyText(message.reasoning)
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).flatMap(
    (call: unknown) => {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } } | null)?.function
      return typeof fn?.name === 'string' && typeof fn.arguments === 'string'
        ? [{ name: fn.name, args: recordedArgs(fn.arguments) }]
        : []
    },
  )
  // `eos` and `function_call` are left out; the step's default reads the same to the app.
  const finish = choice?.finish_reason
  return {
    ...(text !== undefined ? { text } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(isFinishReason(finish) ? { finishReason: finish } : {}),
  }
}

/**
 * Forwards one call to a real provider and pipes the reply straight back, while
 * assembling the assistant text so the request log can offer it as a canned
 * response. The upstream's key is read from the environment at call time — it
 * is never held in mock state and never crosses the control API.
 */
export async function passthrough(opts: {
  upstream: Upstream
  body: Record<string, unknown>
  res: ServerResponse
  signal: AbortSignal
}): Promise<PassthroughResult> {
  const { upstream, body, res, signal } = opts
  const apiKey = upstream.apiKeyEnv ? process.env[upstream.apiKeyEnv] : undefined
  const streamed = body.stream === true

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(completionsUrl(upstream.baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ ...body, model: upstream.model }),
      signal,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (!res.headersSent) {
      res.writeHead(502, { ...CORS_HEADERS, 'content-type': 'application/json' })
      res.end(
        errorBody(`mock passthrough to ${upstream.label} failed: ${detail}`, 'upstream_error'),
      )
    } else {
      res.end()
    }
    return { status: 502, content: '', error: detail }
  }

  if (!upstreamResponse.ok || upstreamResponse.body === null) {
    const raw = await upstreamResponse.text()
    res.writeHead(upstreamResponse.status, {
      ...CORS_HEADERS,
      'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
    })
    res.end(raw)
    return { status: upstreamResponse.status, content: '', error: raw.slice(0, 500) }
  }

  res.writeHead(
    upstreamResponse.status,
    streamed
      ? SSE_HEADERS
      : {
          ...CORS_HEADERS,
          'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
        },
  )

  const decoder = new TextDecoder()
  let raw = ''
  for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
    if (signal.aborted) break
    const text = decoder.decode(chunk, { stream: true })
    raw += text
    await write(res, text)
  }
  res.end()

  const toolStep = toolLaneOf(body) !== null ? toolStepOfCompletion(raw) : null
  return {
    status: upstreamResponse.status,
    content: streamed ? collectSseContent(raw) : messageContent(raw),
    ...(toolStep !== null ? { toolStep } : {}),
  }
}
