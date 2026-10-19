// Transport for SDK providers: Tauri HTTP, a request guard, and debug logging. Responses come back
// unthrown so the SDK builds its own errors; `createTimeoutFetch` adds the text-only layers on top.

import { debug } from '#lib/stores/debug.svelte.ts'
import { createRequestGuard } from '#lib/utils/idleTimeout.ts'
import { httpFetch } from '#lib/utils/http.ts'
import {
  describeRequestBody,
  isBinaryContentType,
  logBinaryResponse,
  logErrorResponse,
  logJsonResponse,
  logStreamResponse,
  redactHeaders,
} from './debugLog'

interface SdkFetchOptions {
  serviceId: string
  timeoutMs: number
  what?: string
  /** Attaches the request to an existing debug entry. */
  debugId?: string
}

/** The plugin takes bytes, not a `FormData`; the `Request` supplies the multipart boundary. */
async function encodeFormData(
  url: string,
  method: string,
  headers: RequestInit['headers'],
  form: FormData,
): Promise<{ body: ArrayBuffer; headers: Headers }> {
  const request = new Request(url, { method, body: form })
  const body = await request.arrayBuffer()
  const encoded = new Headers(headers)
  encoded.set('content-type', request.headers.get('content-type') ?? '')
  return { body, headers: encoded }
}

function logResponse(response: Response, debugId: string, serviceId: string, startTime: number) {
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    void logErrorResponse(response.clone(), debugId, serviceId, startTime)
  } else if (isBinaryContentType(contentType)) {
    logBinaryResponse(response, debugId, serviceId, startTime)
  } else if (contentType.includes('json')) {
    void logJsonResponse(response.clone(), debugId, serviceId, startTime)
  } else {
    void logStreamResponse(response.clone(), debugId, serviceId, startTime)
  }
}

export function createSdkFetch(options: SdkFetchOptions) {
  const { serviceId, timeoutMs, what, debugId: debugIdExternal } = options

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startTime = Date.now()
    const url = input instanceof Request ? input.url : input.toString()
    const method = init?.method ?? 'GET'

    const debugId = debug.addDebugRequest(
      serviceId,
      {
        url,
        method,
        headers: redactHeaders(init?.headers),
        body: describeRequestBody(init?.body),
      },
      debugIdExternal,
    )

    const guard = createRequestGuard({ timeoutMs, what, callerSignal: init?.signal })

    try {
      const request =
        init?.body instanceof FormData
          ? await encodeFormData(url, method, init.headers, init.body)
          : { body: init?.body ?? undefined, headers: init?.headers }

      const response = guard.wrapBody(
        await httpFetch(url, {
          method,
          headers: request.headers,
          body: request.body,
          signal: guard.signal,
        }),
      )
      if (debug.isActive) logResponse(response, debugId, serviceId, startTime)
      return response
    } catch (error) {
      throw guard.mapError(error)
    } finally {
      guard.dispose()
    }
  }
}
