/**
 * Image Fetch Adapter
 *
 * GET helpers for image providers using Tauri's HTTP plugin: model discovery and reference
 * downloads. Generation POSTs go through `createSdkFetch`.
 * Longer default timeout (5 min) since image fetches can be slow.
 */

import { IMAGE_TIMEOUT_DEFAULT } from '#lib/constants/timeout.ts'
import { loggedFetch, logResponse, logStatus } from '#lib/services/http/index.ts'
import { HttpStatusError } from '#lib/utils/error.ts'
import { bytesToBase64 } from '#lib/utils/image.ts'
import { isPublicHttpUrl } from '#lib/utils/url.ts'

/** Redirects followed before giving up; each hop is checked against `isPublicHttpUrl`. */
const MAX_REDIRECTS = 3

/** Downloads an image as raw base64. The URL came from outside, so it and every redirect must be public. */
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
 * A status in `allowStatuses` is returned the same way; the caller reads or cancels its body.
 */
export async function imageGetFetch(
  url: string,
  headers?: Record<string, string>,
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
    serviceId?: string
    followRedirects?: boolean
    allowStatuses?: number[]
  },
): Promise<Response> {
  const {
    signal,
    timeoutMs = IMAGE_TIMEOUT_DEFAULT,
    serviceId = 'image-gen',
    followRedirects = true,
    allowStatuses = [],
  } = options ?? {}

  // The caller reads or cancels these bodies, so they are logged by status alone: a clone would
  // keep the plugin's body open after a cancel.
  const isExpected = (response: Response) =>
    !response.ok &&
    ((response.status >= 300 && response.status < 400 && !followRedirects) ||
      allowStatuses.includes(response.status))

  const response = await loggedFetch(
    url,
    { method: 'GET', headers, ...(followRedirects ? {} : { maxRedirections: 0 }) },
    {
      serviceId,
      timeoutMs,
      what: 'Image fetch',
      signal,
      logResponse: (res, entry) => (isExpected(res) ? logStatus : logResponse)(res, entry),
    },
  )

  if (!response.ok && !isExpected(response)) {
    throw new HttpStatusError(response.status, await response.text(), 'Image API')
  }
  return response
}
