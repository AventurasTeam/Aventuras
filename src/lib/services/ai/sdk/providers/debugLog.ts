// Debug-panel logging shared by the SDK `fetch` adapters.

import { debug } from '#lib/stores/debug.svelte.ts'

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'api-key'])
const BINARY_CONTENT_TYPE = /^(image|audio)\/|^application\/octet-stream/
const SCRUB_MIN_LENGTH = 1024
const BASE64_BODY = /^[A-Za-z0-9+/_-]+={0,2}$/

function normalizeHeaders(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers || Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return headers as Record<string, string>
}

export function redactHeaders(headers: RequestInit['headers']): Record<string, string> {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(normalizeHeaders(headers))) {
    redacted[key] =
      SENSITIVE_HEADERS.has(key.toLowerCase()) && value.length > 8
        ? value.slice(0, 4) + '...' + value.slice(-4)
        : value
  }
  return redacted
}

/** The Gemini safety fields worth surfacing next to a response body. */
export function providerMetadataOf(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const { promptFeedback, candidates } = payload as {
    promptFeedback?: unknown
    candidates?: { safetyRatings?: unknown }[]
  }
  const metadata: Record<string, unknown> = {}
  if (promptFeedback) metadata.promptFeedback = promptFeedback
  if (Array.isArray(candidates) && candidates[0]?.safetyRatings) {
    metadata.safetyRatings = candidates[0].safetyRatings
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export function isBinaryContentType(contentType: string): boolean {
  return BINARY_CONTENT_TYPE.test(contentType)
}

/** Replaces any large `data:` URI or bare base64 string, so the payload stays small enough to show. */
export function scrubBinary(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length >= SCRUB_MIN_LENGTH &&
      (value.startsWith('data:') || BASE64_BODY.test(value))
      ? `[base64, ${value.length} chars]`
      : value
  }
  if (Array.isArray(value)) return value.map(scrubBinary)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, scrubBinary(v)]))
  }
  return value
}

export function describeRequestBody(body: RequestInit['body']): unknown {
  if (typeof body === 'string') {
    try {
      return scrubBinary(JSON.parse(body))
    } catch {
      return { raw: body.slice(0, 200) }
    }
  }
  if (body instanceof FormData) return { formData: [...body.keys()] }
  return undefined
}

export async function logErrorResponse(
  response: Response,
  debugId: string,
  serviceId: string,
  startTime: number,
): Promise<void> {
  try {
    const text = await response.text()
    let errorPayload
    try {
      errorPayload = JSON.parse(text)
    } catch {
      errorPayload = text
    }
    debug.addDebugResponse(
      debugId,
      serviceId,
      { status: response.status, statusText: response.statusText, error: errorPayload },
      startTime,
      text,
    )
  } catch (err) {
    console.warn('[Fetch] Failed to read error response for logging:', err)
  }
}

export async function logJsonResponse(
  response: Response,
  debugId: string,
  serviceId: string,
  startTime: number,
): Promise<void> {
  try {
    const text = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    debug.addDebugResponse(
      debugId,
      serviceId,
      { body: scrubBinary(payload), providerMetadata: providerMetadataOf(payload) },
      startTime,
    )
  } catch (err) {
    console.warn('[Fetch] Failed to read JSON response for logging:', err)
  }
}

/** Logs the type and size without reading the body. */
export function logBinaryResponse(
  response: Response,
  debugId: string,
  serviceId: string,
  startTime: number,
): void {
  const length = response.headers.get('content-length')
  debug.addDebugResponse(
    debugId,
    serviceId,
    {
      contentType: response.headers.get('content-type'),
      size: length === null ? undefined : Number(length),
    },
    startTime,
  )
}

export async function logStreamResponse(
  response: Response,
  debugId: string,
  serviceId: string,
  startTime: number,
): Promise<void> {
  try {
    const text = await response.text()
    let parsedBody: any = text
    const providerMetadata: Record<string, any> = {}
    try {
      const chunks = text.split('\n\n').filter((c) => c.trim())
      const parsedChunks = chunks.map((chunk) => {
        if (chunk.startsWith('data: ')) {
          const dataStr = chunk.slice(6)
          if (dataStr === '[DONE]') return { done: true }
          try {
            const parsed = JSON.parse(dataStr)
            Object.assign(providerMetadata, providerMetadataOf(parsed))
            return parsed
          } catch {
            return chunk
          }
        }
        return chunk
      })

      // Aggregation logic for streaming choices...
      const aggregatedChoices: Record<number, any> = {}
      let aggregatedId = ''
      let aggregatedModel = ''
      let hasAggregation = false

      for (const chunk of parsedChunks) {
        if (typeof chunk !== 'object' || !chunk || !chunk.choices) continue
        hasAggregation = true
        if (chunk.id) aggregatedId = chunk.id
        if (chunk.model) aggregatedModel = chunk.model

        for (const choice of chunk.choices) {
          const idx = choice.index
          aggregatedChoices[idx] ??= {
            index: idx,
            message: { role: 'assistant', content: '' },
            finish_reason: null,
          }
          const agg = aggregatedChoices[idx]
          const delta = choice.delta ?? {}
          if (delta.role) agg.message.role = delta.role
          if (delta.content) agg.message.content += delta.content
          if (delta.reasoning)
            agg.message.reasoning = (agg.message.reasoning || '') + delta.reasoning
          if (delta.tool_calls) {
            agg.message.tool_calls ??= []
            for (const tc of delta.tool_calls) {
              const tcIdx = tc.index
              let aggTc = agg.message.tool_calls.find((t: any) => t.index === tcIdx)
              if (!aggTc) {
                aggTc = {
                  index: tcIdx,
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                }
                agg.message.tool_calls.push(aggTc)
              }
              if (tc.id) aggTc.id = tc.id
              if (tc.type) aggTc.type = tc.type
              if (tc.function?.name) aggTc.function.name = tc.function.name
              if (typeof tc.function?.arguments === 'string')
                aggTc.function.arguments += tc.function.arguments
            }
          }
          if (choice.finish_reason !== undefined && choice.finish_reason !== null)
            agg.finish_reason = choice.finish_reason
        }
      }

      if (hasAggregation) {
        const finalChoices = Object.values(aggregatedChoices).map((choice: any) => {
          if (choice.message.tool_calls) {
            choice.message.tool_calls = choice.message.tool_calls.map((tc: any) => {
              try {
                tc.function.parsed_arguments = JSON.parse(tc.function.arguments)
              } catch {}
              return tc
            })
          }
          return choice
        })

        parsedBody = {
          _note: 'Aggregated from stream',
          id: aggregatedId,
          model: aggregatedModel,
          choices: finalChoices,
        }
      } else if (parsedChunks.length > 0) {
        parsedBody = parsedChunks
      }
    } catch {}

    debug.addDebugResponse(
      debugId,
      serviceId,
      {
        body: parsedBody,
        providerMetadata: Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
        stream: true,
      },
      startTime,
    )
  } catch (err) {
    console.warn('[Fetch] Failed to read streaming response for logging:', err)
  }
}
