// The debug-logged transport: a request entry, the request guard, the plugin, and the response entry.

import { debugLog } from '#lib/stores/debugLog.ts'
import { createRequestGuard } from '#lib/utils/idleTimeout.ts'
import {
  describeRequestBody,
  failureReason,
  logResponse,
  redactHeaders,
  type ResponseLogger,
} from './debugLog'
import { httpFetch, type HttpInit } from './httpFetch'

export interface LoggedFetchOptions {
  serviceId: string
  /** Without it there is no request guard: the caller's signal passes straight through. */
  timeoutMs?: number
  what?: string
  signal?: AbortSignal | null
  /** Attaches the request to an existing debug entry. */
  debugId?: string
  /** False keeps the request out of the debug log, for polls that would crowd out real entries. */
  log?: boolean
  logResponse?: ResponseLogger
}

export async function loggedFetch(
  url: string,
  init: HttpInit,
  options: LoggedFetchOptions,
): Promise<Response> {
  const { serviceId, timeoutMs, what, signal, debugId: externalId, log = true } = options
  const logger = options.logResponse ?? logResponse
  const startTime = Date.now()

  // The only gate: nothing is cloned while debug mode is off.
  const logging = log && debugLog.active
  const debugId = logging
    ? debugLog.addRequest(
        serviceId,
        {
          url,
          method: init.method ?? 'GET',
          headers: redactHeaders(init.headers),
          body: describeRequestBody(init.body),
        },
        externalId,
      )
    : ''

  const guard =
    timeoutMs === undefined
      ? undefined
      : createRequestGuard({ timeoutMs, what, callerSignal: signal })

  try {
    const raw = await httpFetch(url, { ...init, signal: guard?.signal ?? signal })
    const response = guard ? guard.wrapBody(raw) : raw
    if (logging) {
      // A logger must not fail a request that succeeded.
      try {
        logger(response, { debugId, serviceId, startTime })
      } catch (err) {
        console.warn('[Fetch] Failed to log the response:', err)
      }
    }
    return response
  } catch (error) {
    const mapped = guard ? guard.mapError(error) : error
    if (logging) {
      const reason = failureReason(mapped)
      debugLog.addResponse(debugId, serviceId, { error: reason }, startTime, reason)
    }
    throw mapped
  } finally {
    guard?.dispose()
  }
}
