// Transport for SDK image providers: Tauri HTTP, a request guard, and debug logging. Responses come
// back unthrown so the SDK builds its own errors. `createTimeoutFetch` is the text-model transport.

import { debug } from '#lib/stores/debug.svelte.ts'
import { errMessage } from '#lib/utils/error.ts'
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
  scrubBase64,
} from './debugLog'

interface SdkFetchOptions {
  serviceId: string
  timeoutMs: number
  what?: string
  /** Attaches the request to an existing debug entry. */
  debugId?: string
  /** False keeps the request out of the debug log, for polls that would crowd out real entries. */
  log?: boolean
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

const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input.toString()

export function createSdkFetch(options: SdkFetchOptions): Fetch {
  const { serviceId, timeoutMs, what, debugId: debugIdExternal, log = true } = options

  return async (input, init) => {
    const startTime = Date.now()
    const url = requestUrl(input)
    const method = init?.method ?? 'GET'

    const logging = log && debug.isActive
    const debugId = logging
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
      if (logging) logResponse(response, debugId, serviceId, startTime)
      return response
    } catch (error) {
      throw guard.mapError(error)
    } finally {
      guard.dispose()
    }
  }
}

const MAX_FAILURES_KEPT = 20
const FAILURE_BODY_EXCERPT = 200

interface PollFailure {
  method: string
  url: string
  status?: number
  error?: string
  body?: string
}

type PollRequest =
  | { method: string; url: string; status: number; body: unknown }
  | { method: string; url: string; error: string }

/**
 * A fetch whose requests share one debug entry, updated in place: how many there were, the last
 * request with its response, and the ones that failed. For polls, which would otherwise push the
 * generation's own requests out of the log.
 */
export function createPollSdkFetch(options: Omit<SdkFetchOptions, 'log' | 'debugId'>): Fetch {
  const { serviceId } = options
  const inner = createSdkFetch({ ...options, log: false })
  let debugId: string | undefined
  let startTime = 0
  let requests = 0
  let failures: PollFailure[] = []
  // Keeps writes in request order while each one waits for its body.
  let queue: Promise<void> = Promise.resolve()

  const enqueue = (task: () => Promise<void> | void) => {
    queue = queue
      .then(task)
      .catch((err: unknown) => console.warn('[Fetch] Failed to write the poll debug entry:', err))
  }

  const write = (id: string, count: number, last: PollRequest, failure?: PollFailure) => {
    if (failure) failures = [...failures, failure].slice(-MAX_FAILURES_KEPT)
    debug.addDebugResponse(
      id,
      serviceId,
      { requests: count, last, ...(failures.length > 0 && { failures }) },
      startTime,
    )
  }

  return async (input, init) => {
    if (!debug.isActive) return inner(input, init)

    const url = requestUrl(input)
    const method = init?.method ?? 'GET'
    if (debugId === undefined) {
      startTime = Date.now()
      debugId = debug.addDebugRequest(serviceId, {
        url,
        method,
        headers: redactHeaders(init?.headers),
        body: describeRequestBody(init?.body),
      })
    }
    const id = debugId
    const count = ++requests

    let response: Response
    try {
      response = await inner(input, init)
    } catch (error) {
      const message = errMessage(error)
      enqueue(() =>
        write(id, count, { method, url, error: message }, { method, url, error: message }),
      )
      throw error
    }

    // Cloned before the caller reads the body, which a clone taken later could not copy.
    const copy = response.clone()
    const { status, ok } = response
    enqueue(async () => {
      const text = await copy.text()
      let body: unknown
      try {
        body = JSON.parse(text, (_key, value) => scrubBase64(value))
      } catch {
        body = scrubBase64(text)
      }
      write(
        id,
        count,
        { method, url, status, body },
        ok
          ? undefined
          : { method, url, status, body: text.slice(0, FAILURE_BODY_EXCERPT) || undefined },
      )
    })
    return response
  }
}
