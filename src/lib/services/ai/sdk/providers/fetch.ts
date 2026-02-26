/**
 * Tauri Fetch Adapter
 *
 * Wraps @tauri-apps/plugin-http's fetch for Vercel AI SDK providers.
 * Patches common provider response issues before SDK validation.
 */

import { ui } from '$lib/stores/ui.svelte'
import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'

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
  timeoutMs = 180000,
  serviceId: string,
  debugIdExternal?: string,
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    init?.signal?.addEventListener('abort', () => controller.abort())
    const startTime = Date.now()
    let parsedBody: unknown = {}
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        parsedBody = { raw: init.body.slice(0, 200) }
      }
    }
    const debugId = ui.addDebugRequest(
      serviceId,
      {
        url: input.toString(),
        method: init?.method ?? 'GET',
        body: parsedBody,
      },
      debugIdExternal,
    )
    try {
      const response = await tauriFetch(input, { ...init, signal: controller.signal })

      if (!response.ok) {
        const error = await response.text()
        let errorPayload
        try {
          errorPayload = JSON.parse(error)
        } catch {
          errorPayload = error
        }
        ui.addDebugResponse(
          debugId,
          serviceId,
          { status: response.status, error: errorPayload, statusText: response.statusText },
          startTime,
          error,
        )
      }

      if (!response.headers.get('content-type')?.includes('application/json')) {
        // For streams (e.g. text/event-stream), we must not consume the origin body.
        // We clone it, read the clone in the background, and log the final accumulated payload.
        const clonedResponse = response.clone()
        clonedResponse
          .text()
          .then((text) => {
            let parsedBody: any = text
            try {
              // Attempt to parse SSE stream into a JSON array for better debug display
              const chunks = text.split('\n\n').filter((c) => c.trim())
              const parsedChunks = chunks.map((chunk) => {
                if (chunk.startsWith('data: ')) {
                  const dataStr = chunk.slice(6)
                  if (dataStr === '[DONE]') return { done: true }
                  try {
                    return JSON.parse(dataStr)
                  } catch {
                    return chunk
                  }
                }
                return chunk
              })

              // Aggregate chunks into a single response object
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
                  if (delta.reasoning) {
                    agg.message.reasoning = (agg.message.reasoning || '') + delta.reasoning
                  }

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
                      if (typeof tc.function?.arguments === 'string') {
                        aggTc.function.arguments += tc.function.arguments
                      }
                    }
                  }

                  if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
                    agg.finish_reason = choice.finish_reason
                  }
                }
              }

              if (hasAggregation) {
                // Parse the tool call arguments into objects for even better readability
                const finalChoices = Object.values(aggregatedChoices).map((choice: any) => {
                  if (choice.message.tool_calls) {
                    choice.message.tool_calls = choice.message.tool_calls.map((tc: any) => {
                      try {
                        tc.function.parsed_arguments = JSON.parse(tc.function.arguments)
                      } catch {
                        // ignore
                      }
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
            } catch {
              // Fallback to raw text
            }

            ui.addDebugResponse(
              debugId,
              serviceId,
              {
                url: input.toString(),
                method: init?.method ?? 'GET',
                body: parsedBody,
                stream: true,
              },
              startTime,
            )
          })
          .catch((err) => {
            console.warn('[Fetch] Failed to read streaming debug response:', err)
          })

        return response
      }

      const text = await response.text()

      let responsePayload
      if (!(parsedBody as Record<string, unknown>).stream) {
        try {
          responsePayload = JSON.parse(text)
        } catch {
          responsePayload = text
        }
        ui.addDebugResponse(
          debugId,
          serviceId,
          {
            url: input.toString(),
            method: init?.method ?? 'GET',
            body: responsePayload,
          },
          startTime,
        )
      }

      ui.addDebugResponse(
        debugId,
        serviceId,
        {
          url: input.toString(),
          method: init?.method ?? 'GET',
          body: responsePayload,
        },
        startTime,
      )

      try {
        const json = JSON.parse(text)
        const patched = JSON.stringify(patchResponseJson(json))
        return new Response(patched, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      } catch {
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
