/**
 * Image Fetch Adapter
 *
 * Shared fetch wrapper for image providers using Tauri's HTTP plugin.
 * Handles timeout, debug logging, and both JSON and FormData bodies.
 * Longer default timeout (5 min) since image generation is slow.
 */

import { debug } from '#lib/stores/debug.svelte.ts'
import { createRequestGuard } from '#lib/utils/idleTimeout.ts'
import { bytesToBase64 } from '#lib/utils/image.ts'
import { isPublicHttpUrl } from '#lib/utils/url.ts'
import { httpFetch } from '#lib/utils/http.ts'

const DEFAULT_IMAGE_TIMEOUT = 5 * 60 * 1000 // 5 minutes

function normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
  return headers ?? {}
}

async function logImageResponse(
  response: Response,
  debugId: string,
  serviceId: string,
  startTime: number,
): Promise<void> {
  try {
    const text = await response.text()
    let responsePayload: unknown
    try {
      responsePayload = JSON.parse(text)
    } catch {
      responsePayload = { size: text.length }
    }
    debug.addDebugResponse(debugId, serviceId, { body: responsePayload }, startTime)
  } catch {
    // Debug logging is best-effort.
  }
}

/**
 * POST-based image fetch (JSON or FormData body).
 */
export async function imageFetch(options: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | FormData
  signal?: AbortSignal
  timeoutMs?: number
  serviceId?: string
}): Promise<Response> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    signal,
    timeoutMs = DEFAULT_IMAGE_TIMEOUT,
    serviceId = 'image-gen',
  } = options

  const guard = createRequestGuard({
    timeoutMs,
    what: 'Image generation',
    callerSignal: signal,
  })
  const startTime = Date.now()

  // Safe debug logging - don't parse FormData as JSON
  let debugBody: unknown = {}
  if (typeof body === 'string') {
    try {
      debugBody = JSON.parse(body)
    } catch {
      debugBody = { raw: body.slice(0, 200) }
    }
  } else if (body instanceof FormData) {
    debugBody = { formData: [...body.keys()] }
  }

  const debugId = debug.addDebugRequest(serviceId, { url, method, body: debugBody })

  try {
    let response: Response

    if (body instanceof FormData) {
      // For FormData, use Request object so Tauri handles multipart encoding
      const request = new Request(url, {
        method,
        headers: normalizeHeaders(headers),
        body,
        signal: guard.signal,
      })
      // Convert to arrayBuffer for Tauri compatibility
      const arrayBuf = await request.arrayBuffer()
      const contentType = request.headers.get('content-type') ?? ''
      response = await httpFetch(url, {
        method,
        headers: { ...normalizeHeaders(headers), 'content-type': contentType },
        body: arrayBuf,
        signal: guard.signal,
      })
    } else {
      response = await httpFetch(url, {
        method,
        headers: normalizeHeaders(headers),
        body: body as string | undefined,
        signal: guard.signal,
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      let errorPayload: unknown
      try {
        errorPayload = JSON.parse(errorText)
      } catch {
        errorPayload = errorText
      }
      debug.addDebugResponse(
        debugId,
        serviceId,
        { status: response.status, error: errorPayload, statusText: response.statusText },
        startTime,
        errorText,
      )
      const err = errorPayload as any
      const humanMessage =
        typeof errorPayload === 'string'
          ? errorPayload
          : (err?.error?.message ?? err?.message ?? err?.error)
      throw new Error(
        `Image API error ${response.status}: ${humanMessage ?? JSON.stringify(errorPayload)}`,
      )
    }

    response = guard.wrapBody(response)
    // Only buffer the body for the debug panel when debug is active. Otherwise hand the
    // response straight to the caller (which chooses .json()/.blob()): this avoids forcing
    // text() on every response — which would also corrupt binary image bodies — and skips a
    // redundant full-body copy + double parse.
    if (debug.isActive) {
      void logImageResponse(response.clone(), debugId, serviceId, startTime)
    }

    return response
  } catch (error) {
    throw guard.mapError(error)
  } finally {
    guard.dispose()
  }
}

/** Downloads an image from a third-party host as raw base64. Never sends an API key. */
export async function fetchImageBase64(
  url: string,
  options?: { signal?: AbortSignal; serviceId?: string },
): Promise<string> {
  const response = await imageGetFetch(url, undefined, options)
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()))
}

/** Redirects followed before giving up; each hop is checked against `isPublicHttpUrl`. */
const MAX_REDIRECTS = 3

/** Like `fetchImageBase64`, for a URL that came from outside: the URL and every redirect must be public. */
export async function fetchPublicImageBase64(
  url: string,
  options?: { signal?: AbortSignal; serviceId?: string; timeoutMs?: number },
): Promise<string> {
  let target = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(target)) {
      throw new Error('Image URL does not point at a public host')
    }
    const response = await imageGetFetch(target, undefined, { ...options, followRedirects: false })
    if (response.status < 300 || response.status >= 400) {
      return bytesToBase64(new Uint8Array(await response.arrayBuffer()))
    }
    // The plugin keeps an unread body open on the Rust side.
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location) throw new Error(`Image URL redirected (${response.status}) without a Location`)
    target = new URL(location, target).href
  }
  throw new Error('Image URL redirected too many times')
}

/**
 * GET-based image fetch (for providers like Pollinations that use URL params).
 * With `followRedirects: false` a 3xx is returned to the caller instead of followed or thrown.
 */
export async function imageGetFetch(
  url: string,
  headers?: Record<string, string>,
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
    serviceId?: string
    followRedirects?: boolean
  },
): Promise<Response> {
  const {
    signal,
    timeoutMs = DEFAULT_IMAGE_TIMEOUT,
    serviceId = 'image-gen',
    followRedirects = true,
  } = options ?? {}

  const guard = createRequestGuard({ timeoutMs, what: 'Image fetch', callerSignal: signal })
  const startTime = Date.now()
  const debugId = debug.addDebugRequest(serviceId, { url, method: 'GET', body: {} })

  try {
    const response = await httpFetch(url, {
      method: 'GET',
      headers: normalizeHeaders(headers),
      signal: guard.signal,
      ...(followRedirects ? {} : { maxRedirections: 0 }),
    })

    const isRedirect = response.status >= 300 && response.status < 400
    if (!response.ok && !(isRedirect && !followRedirects)) {
      const errorText = await response.text()
      debug.addDebugResponse(
        debugId,
        serviceId,
        { status: response.status, error: errorText },
        startTime,
        errorText,
      )
      throw new Error(`Image API error ${response.status}: ${errorText}`)
    }

    debug.addDebugResponse(debugId, serviceId, { status: response.status }, startTime)
    return guard.wrapBody(response)
  } catch (error) {
    throw guard.mapError(error)
  } finally {
    guard.dispose()
  }
}
