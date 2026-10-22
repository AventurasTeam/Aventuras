// Transport for SDK image providers: Tauri HTTP, a request guard, and debug logging. Responses come
// back unthrown so the SDK builds its own errors. `createTimeoutFetch` is the text-model transport.

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

// The plugin encodes a `FormData` itself and fills in the multipart boundary, but only when the
// caller has set no `content-type`.
function headersFor(init: RequestInit | undefined): RequestInit['headers'] {
  if (!(init?.body instanceof FormData)) return init?.headers
  const headers = new Headers(init.headers)
  headers.delete('content-type')
  return headers
}

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

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

    const debugId = debug.isActive
      ? debug.addDebugRequest(
          serviceId,
          {
            url,
            method,
            headers: redactHeaders(init?.headers),
            body: describeRequestBody(init?.body),
          },
          debugIdExternal,
        )
      : ''

    const guard = createRequestGuard({ timeoutMs, what, callerSignal: init?.signal })

    try {
      const response = guard.wrapBody(
        await httpFetch(url, {
          method,
          headers: headersFor(init),
          body: init?.body,
          signal: guard.signal,
          // The SDK follows redirects itself, to validate each hop.
          ...(init?.redirect === 'manual' && { maxRedirections: 0 }),
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
