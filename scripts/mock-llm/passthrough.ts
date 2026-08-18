import type { ServerResponse } from 'node:http'

import { CORS_HEADERS, SSE_HEADERS, errorBody, write } from './respond/wire'
import type { Upstream } from './state'

export type PassthroughResult = {
  status: number
  /** Assembled assistant text — what record mode saves as a canned response. */
  content: string
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

  return {
    status: upstreamResponse.status,
    content: streamed ? collectSseContent(raw) : messageContent(raw),
  }
}
