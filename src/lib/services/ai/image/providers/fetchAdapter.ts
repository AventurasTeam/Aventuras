/**
 * Image Fetch Adapter
 *
 * Shared fetch wrapper for image providers using Tauri's HTTP plugin.
 * Handles timeout, debug logging, and both JSON and FormData bodies.
 * Longer default timeout (5 min) since image generation is slow.
 */

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { ui } from '$lib/stores/ui.svelte'

const DEFAULT_IMAGE_TIMEOUT = 5 * 60 * 1000 // 5 minutes

function normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
  return headers ?? {}
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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort())

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
    const keys: string[] = []
    body.forEach((_val, key) => keys.push(key))
    debugBody = { formData: keys }
  }

  const debugId = ui.addDebugRequest(serviceId, { url, method, body: debugBody })

  try {
    let response: Response

    if (body instanceof FormData) {
      // For FormData, use Request object so Tauri handles multipart encoding
      const request = new Request(url, {
        method,
        headers: normalizeHeaders(headers),
        body,
        signal: controller.signal,
      })
      // Convert to arrayBuffer for Tauri compatibility
      const arrayBuf = await request.arrayBuffer()
      const contentType = request.headers.get('content-type') || ''
      response = await tauriHttpFetch(url, {
        method,
        headers: { ...normalizeHeaders(headers), 'content-type': contentType },
        body: arrayBuf as unknown as BodyInit,
        signal: controller.signal,
      })
    } else {
      response = await tauriHttpFetch(url, {
        method,
        headers: normalizeHeaders(headers),
        body: body as string | undefined,
        signal: controller.signal,
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
      ui.addDebugResponse(
        debugId,
        serviceId,
        { status: response.status, error: errorPayload, statusText: response.statusText },
        startTime,
        errorText,
      )
      throw new Error(
        `Image API error ${response.status}: ${typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload)}`,
      )
    }

    // Log successful response for debug panel
    const text = await response.text()
    let responsePayload: unknown
    try {
      responsePayload = JSON.parse(text)
    } catch {
      responsePayload = { size: text.length }
    }
    ui.addDebugResponse(debugId, serviceId, { body: responsePayload }, startTime)

    // Return a new response with the consumed text
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Image generation timed out after ${timeoutMs / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * GET-based image fetch (for providers like Pollinations that use URL params).
 */
export async function imageGetFetch(
  url: string,
  headers?: Record<string, string>,
  options?: { signal?: AbortSignal; timeoutMs?: number; serviceId?: string },
): Promise<Response> {
  const { signal, timeoutMs = DEFAULT_IMAGE_TIMEOUT, serviceId = 'image-gen' } = options ?? {}

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort())

  const startTime = Date.now()
  const debugId = ui.addDebugRequest(serviceId, { url, method: 'GET', body: {} })

  try {
    const response = await tauriHttpFetch(url, {
      method: 'GET',
      headers: normalizeHeaders(headers),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      ui.addDebugResponse(
        debugId,
        serviceId,
        { status: response.status, error: errorText },
        startTime,
        errorText,
      )
      throw new Error(`Image API error ${response.status}: ${errorText}`)
    }

    ui.addDebugResponse(debugId, serviceId, { status: response.status }, startTime)
    return response
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Image fetch timed out after ${timeoutMs / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
