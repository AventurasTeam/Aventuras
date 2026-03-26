/**
 * Tauri Fetch Adapter
 *
 * Wraps @tauri-apps/plugin-http's fetch for Vercel AI SDK providers.
 * Patches common provider response issues before SDK validation.
 */

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { LLM_TIMEOUT_DEFAULT } from '$lib/constants/timeout'
import { parseManualBody } from '$lib/services/ai/core/requestOverrides'
import { debug } from '$lib/stores/debug.svelte'

function normalizeHeaders(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return headers as Record<string, string>
}

async function tauriFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return tauriHttpFetch(typeof input === 'string' ? input : input.toString(), {
    method: init?.method ?? 'GET',
    headers: normalizeHeaders(init?.headers),
    body: init?.body as string | undefined,
    signal: init?.signal,
  })
}

function patchResponseJson(json: Record<string, unknown>): Record<string, unknown> {
  if (!json.usage) {
    json.usage = { input_tokens: 0, output_tokens: 0 }
  } else if (typeof json.usage === 'object') {
    const usage = json.usage as Record<string, unknown>
    usage.input_tokens ??= usage.prompt_tokens ?? 0
    usage.output_tokens ??= usage.completion_tokens ?? 0
  }
  return json
}

export function createTimeoutFetch(
  timeoutMs = LLM_TIMEOUT_DEFAULT,
  serviceId: string,
  manualBody: string = '',
  debugIdExternal?: string,
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    init?.signal?.addEventListener('abort', () => controller.abort())
    const startTime = Date.now()
    let parsedBody: any = {}
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        throw new Error('Request body is not valid JSON')
      }
    }

    const manual = parseManualBody(manualBody)
    if (manual) {
      const reservedKeys = new Set(['messages', 'tools', 'tool_choice', 'stream', 'model'])
      for (const [key, value] of Object.entries(manual)) {
        if (!reservedKeys.has(key)) {
          parsedBody[key] = value
        }
      }
    } else if (manualBody.trim()) {
      console.log('[Fetch] Invalid manualBody JSON, skipping')
    }

    if (Object.keys(parsedBody).length === 0) {
      parsedBody = undefined
    }

    const rawHeaders = normalizeHeaders(init?.headers)
    const sanitizedHeaders: Record<string, string> = {}
    const sensitiveKeys = new Set(['authorization', 'x-api-key', 'api-key'])
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (sensitiveKeys.has(key.toLowerCase()) && value.length > 8) {
        sanitizedHeaders[key] = value.slice(0, 4) + '...' + value.slice(-4)
      } else {
        sanitizedHeaders[key] = value
      }
    }

    const debugId = debug.addDebugRequest(
      serviceId,
      {
        url: input.toString(),
        method: init?.method ?? 'GET',
        headers: sanitizedHeaders,
        body: parsedBody,
      },
      debugIdExternal,
    )
    try {
      const response = await tauriFetch(input, {
        ...init,
        signal: controller.signal,
        body: parsedBody ? JSON.stringify(parsedBody) : undefined,
      })

      // Path A: Error Response (Non-2xx)
      // We log the error asynchronously and return the original response immediately.
      // This ensures the SDK receives the correct status and body for its own error handling.
      if (!response.ok) {
        const clonedResponse = response.clone()
        clonedResponse
          .text()
          .then((text) => {
            let errorPayload
            try {
              errorPayload = JSON.parse(text)
            } catch {
              errorPayload = text
            }
            debug.addDebugResponse(
              debugId,
              serviceId,
              {
                status: response.status,
                statusText: response.statusText,
                error: errorPayload,
              },
              startTime,
              text,
            )
          })
          .catch((err) => {
            console.warn('[Fetch] Failed to read error response for logging:', err)
          })
        return response
      }

      // Path B: Non-JSON Success Response (mostly Streams)
      if (!response.headers.get('content-type')?.includes('application/json')) {
        const clonedResponse = response.clone()
        clonedResponse
          .text()
          .then((text) => {
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
                    if (parsed.promptFeedback)
                      providerMetadata.promptFeedback = parsed.promptFeedback
                    if (parsed.candidates?.[0]?.safetyRatings) {
                      providerMetadata.safetyRatings = parsed.candidates[0].safetyRatings
                    }
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
                  if (!aggregatedChoices[idx]) {
                    aggregatedChoices[idx] = {
                      index: idx,
                      message: { role: 'assistant', content: '' },
                      finish_reason: null,
                    }
                  }
                  const agg = aggregatedChoices[idx]
                  const delta = choice.delta || {}
                  if (delta.role) agg.message.role = delta.role
                  if (delta.content) agg.message.content += delta.content
                  if (delta.reasoning)
                    agg.message.reasoning = (agg.message.reasoning || '') + delta.reasoning
                  if (delta.tool_calls) {
                    if (!agg.message.tool_calls) agg.message.tool_calls = []
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
                providerMetadata:
                  Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
                stream: true,
              },
              startTime,
            )
          })
          .catch((err) => {
            console.warn('[Fetch] Failed to read streaming response for logging:', err)
          })
        return response
      }

      // Path C: JSON Success Response (Normal completion)
      const text = await response.text()
      let responsePayload
      try {
        responsePayload = JSON.parse(text)
      } catch {
        responsePayload = text
      }

      const providerMetadata: Record<string, any> = {}
      if (typeof responsePayload === 'object' && responsePayload !== null) {
        if (responsePayload.promptFeedback)
          providerMetadata.promptFeedback = responsePayload.promptFeedback
        if (
          Array.isArray(responsePayload.candidates) &&
          responsePayload.candidates[0]?.safetyRatings
        ) {
          providerMetadata.safetyRatings = responsePayload.candidates[0].safetyRatings
        }
      }

      debug.addDebugResponse(
        debugId,
        serviceId,
        {
          body: responsePayload,
          providerMetadata: Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
        },
        startTime,
      )

      if (typeof responsePayload === 'object' && responsePayload !== null) {
        const patched = JSON.stringify(
          patchResponseJson(responsePayload as Record<string, unknown>),
        )
        return new Response(patched, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }

      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
