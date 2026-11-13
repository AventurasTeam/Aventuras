/**
 * Tauri Fetch Adapter
 *
 * Wraps loggedFetch for Vercel AI SDK providers.
 * Patches common provider response issues before SDK validation.
 */

import { LLM_TIMEOUT_DEFAULT } from '#lib/constants/timeout.ts'
import { parseManualBody } from './manualBody'
import { loggedFetch } from '#lib/services/http/index.ts'
import { logSdkResponse } from './debugLog'

interface Usage {
  input_tokens?: number
  output_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
}

function patchResponseJson(json: object): object {
  const usage = 'usage' in json ? json.usage : undefined
  if (!usage) {
    Object.assign(json, { usage: { input_tokens: 0, output_tokens: 0 } })
  } else if (typeof usage === 'object') {
    const patched: Usage = usage
    patched.input_tokens ??= patched.prompt_tokens ?? 0
    patched.output_tokens ??= patched.completion_tokens ?? 0
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
    let requestBody: Record<string, unknown> = {}
    if (typeof init?.body === 'string') {
      try {
        requestBody = JSON.parse(init.body)
      } catch {
        throw new Error('Request body is not valid JSON')
      }
    }

    const manual = parseManualBody(manualBody)
    const reservedKeys = new Set(['messages', 'tools', 'tool_choice', 'stream', 'model'])
    const manualEntries = Object.entries(manual ?? {}).filter(([key]) => !reservedKeys.has(key))
    if (!manual && manualBody.trim()) {
      console.log('[Fetch] Invalid manualBody JSON, skipping')
    }

    const merged = { ...requestBody, ...Object.fromEntries(manualEntries) }
    const parsedBody = Object.keys(merged).length > 0 ? merged : undefined

    const response = await loggedFetch(
      input.toString(),
      {
        method: init?.method,
        headers: init?.headers,
        body: parsedBody ? JSON.stringify(parsedBody) : undefined,
      },
      {
        serviceId,
        timeoutMs,
        signal: init?.signal,
        debugId: debugIdExternal,
        logResponse: logSdkResponse,
      },
    )

    // Errors and streams go back to the SDK unread; only a JSON success is buffered and patched.
    // The buffered body is bounded by the idle timer on each read, not by a total deadline.
    const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
    if (!response.ok || !isJson) return response

    const text = await response.text()
    let responsePayload
    try {
      responsePayload = JSON.parse(text)
    } catch {
      responsePayload = text
    }

    if (typeof responsePayload === 'object' && responsePayload !== null) {
      const patched = JSON.stringify(patchResponseJson(responsePayload))
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
  }
}
