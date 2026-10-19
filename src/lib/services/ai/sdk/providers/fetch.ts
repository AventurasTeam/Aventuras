/**
 * Tauri Fetch Adapter
 *
 * Wraps httpFetch for Vercel AI SDK providers.
 * Patches common provider response issues before SDK validation.
 */

import { LLM_TIMEOUT_DEFAULT } from '#lib/constants/timeout.ts'
import { parseManualBody } from './manualBody'
import { debug } from '#lib/stores/debug.svelte.ts'
import { createRequestGuard } from '#lib/utils/idleTimeout.ts'
import { httpFetch } from '#lib/utils/http.ts'
import { logErrorResponse, logStreamResponse, providerMetadataOf, redactHeaders } from './debugLog'

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

    const debugId = debug.addDebugRequest(
      serviceId,
      {
        url: input.toString(),
        method: init?.method ?? 'GET',
        headers: redactHeaders(init?.headers),
        body: parsedBody,
      },
      debugIdExternal,
    )

    const guard = createRequestGuard({ timeoutMs, callerSignal: init?.signal })

    try {
      let response = await httpFetch(input.toString(), {
        method: init?.method,
        headers: init?.headers,
        body: parsedBody ? JSON.stringify(parsedBody) : undefined,
        signal: guard.signal,
      })

      // Paths A and B hand the body to the caller unread, so it needs its own idle timer.
      // Path C buffers below, which the header timer bounds: `dispose()` runs after `response.text()`.
      const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
      if (!response.ok || !isJson) response = guard.wrapBody(response)

      // Path A: Error Response (Non-2xx)
      // We log the error asynchronously and return the original response immediately.
      // This ensures the SDK receives the correct status and body for its own error handling.
      if (!response.ok) {
        // Only buffer the body when debug logging is active — otherwise reading a clone
        // of every error response just wastes memory.
        if (debug.isActive) {
          void logErrorResponse(response.clone(), debugId, serviceId, startTime)
        }
        return response
      }

      // Path B: Non-JSON Success Response (mostly Streams)
      if (!isJson) {
        // Stream/non-JSON success — only buffer the full body for the debug panel when active.
        if (debug.isActive) {
          void logStreamResponse(response.clone(), debugId, serviceId, startTime)
        }
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

      debug.addDebugResponse(
        debugId,
        serviceId,
        { body: responsePayload, providerMetadata: providerMetadataOf(responsePayload) },
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
    } catch (error) {
      throw guard.mapError(error)
    } finally {
      guard.dispose()
    }
  }
}
