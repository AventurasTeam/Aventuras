// Debug-panel logging shared by the SDK `fetch` adapters.

import { debug } from '#lib/stores/debug.svelte.ts'

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'api-key', 'x-goog-api-key'])
const BINARY_CONTENT_TYPE = /^(image|audio)\/|octet-stream/
const SCRUB_MIN_LENGTH = 1024
const BASE64_BODY = /^[A-Za-z0-9+/_-]+={0,2}$/

// Not `new Headers(init)`: it lowercases names, and the panel shows them as sent.
function headerEntries(headers: HeadersInit | undefined): Iterable<[string, string]> {
  if (!headers) return []
  if (headers instanceof Headers || Array.isArray(headers)) return headers
  return Object.entries(headers)
}

export function redactHeaders(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(
    Array.from(headerEntries(headers), ([key, value]) => [
      key,
      SENSITIVE_HEADERS.has(key.toLowerCase()) && value.length > 8
        ? value.slice(0, 4) + '...' + value.slice(-4)
        : value,
    ]),
  )
}

interface ProviderMetadata {
  promptFeedback?: unknown
  safetyRatings?: unknown
}

/** The Gemini safety fields worth surfacing next to a response body. */
export function providerMetadataOf(payload: unknown): ProviderMetadata | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  // A key with no value stays absent: `Object.assign` across stream chunks would let an
  // explicit `undefined` wipe the value from an earlier chunk.
  const metadata: ProviderMetadata = {}
  if ('promptFeedback' in payload && payload.promptFeedback) {
    metadata.promptFeedback = payload.promptFeedback
  }
  if ('candidates' in payload && Array.isArray(payload.candidates)) {
    const first: unknown = payload.candidates[0]
    if (
      typeof first === 'object' &&
      first !== null &&
      'safetyRatings' in first &&
      first.safetyRatings
    ) {
      metadata.safetyRatings = first.safetyRatings
    }
  }
  return nonEmpty(metadata)
}

function nonEmpty(metadata: ProviderMetadata): ProviderMetadata | undefined {
  return metadata.promptFeedback || metadata.safetyRatings ? metadata : undefined
}

export function isBinaryContentType(contentType: string): boolean {
  return BINARY_CONTENT_TYPE.test(contentType)
}

/** Replaces a large `data:` URI or bare base64 string, so the payload stays small enough to show. */
export function scrubBase64(value: unknown): unknown {
  return typeof value === 'string' &&
    value.length >= SCRUB_MIN_LENGTH &&
    (value.startsWith('data:') || BASE64_BODY.test(value))
    ? `[base64, ${value.length} chars]`
    : value
}

export function describeRequestBody(body: RequestInit['body']): unknown {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body, (_key, value) => scrubBase64(value))
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
    let body: unknown
    try {
      body = JSON.parse(text, (_key, value) => scrubBase64(value))
    } catch {
      body = scrubBase64(text)
    }
    debug.addDebugResponse(
      debugId,
      serviceId,
      { body, providerMetadata: providerMetadataOf(body) },
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

interface ToolCallDelta {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: unknown }
}

interface ChoiceChunk {
  index: number
  delta?: {
    role?: string
    content?: string
    reasoning?: string
    tool_calls?: ToolCallDelta[]
  }
  finish_reason?: string | null
}

interface CompletionChunk {
  id?: string
  model?: string
  choices: ChoiceChunk[]
}

interface AggregatedToolCall {
  index: number
  id: string
  type: string
  function: { name: string; arguments: string; parsed_arguments?: unknown }
}

interface AggregatedChoice {
  index: number
  message: {
    role: string
    content: string
    reasoning?: string
    tool_calls?: AggregatedToolCall[]
  }
  finish_reason: string | null
}

function isCompletionChunk(value: unknown): value is CompletionChunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    'choices' in value &&
    Array.isArray(value.choices)
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
    let parsedBody: unknown = text
    const providerMetadata: ProviderMetadata = {}
    try {
      const chunks = text.split('\n\n').filter((c) => c.trim())
      const parsedChunks = chunks.map((chunk): unknown => {
        if (chunk.startsWith('data: ')) {
          const dataStr = chunk.slice(6)
          if (dataStr === '[DONE]') return { done: true }
          try {
            const parsed: unknown = JSON.parse(dataStr)
            Object.assign(providerMetadata, providerMetadataOf(parsed))
            return parsed
          } catch {
            return chunk
          }
        }
        return chunk
      })

      const aggregatedChoices = new Map<number, AggregatedChoice>()
      let aggregatedId = ''
      let aggregatedModel = ''
      let hasAggregation = false

      for (const chunk of parsedChunks) {
        if (!isCompletionChunk(chunk)) continue
        hasAggregation = true
        if (chunk.id) aggregatedId = chunk.id
        if (chunk.model) aggregatedModel = chunk.model

        for (const choice of chunk.choices) {
          let agg = aggregatedChoices.get(choice.index)
          if (!agg) {
            agg = {
              index: choice.index,
              message: { role: 'assistant', content: '' },
              finish_reason: null,
            }
            aggregatedChoices.set(choice.index, agg)
          }
          const delta = choice.delta ?? {}
          if (delta.role) agg.message.role = delta.role
          if (delta.content) agg.message.content += delta.content
          if (delta.reasoning)
            agg.message.reasoning = (agg.message.reasoning || '') + delta.reasoning
          if (delta.tool_calls) {
            const toolCalls = (agg.message.tool_calls ??= [])
            for (const tc of delta.tool_calls) {
              let aggTc = toolCalls.find((t) => t.index === tc.index)
              if (!aggTc) {
                aggTc = {
                  index: tc.index,
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                }
                toolCalls.push(aggTc)
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
        const finalChoices = [...aggregatedChoices.values()]
        for (const choice of finalChoices) {
          for (const tc of choice.message.tool_calls ?? []) {
            try {
              tc.function.parsed_arguments = JSON.parse(tc.function.arguments)
            } catch {}
          }
        }

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
        providerMetadata: nonEmpty(providerMetadata),
        stream: true,
      },
      startTime,
    )
  } catch (err) {
    console.warn('[Fetch] Failed to read streaming response for logging:', err)
  }
}
