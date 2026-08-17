import { fetch as expoFetch } from 'expo/fetch'

/**
 * React Native's global `fetch` is `require('whatwg-fetch')` — an XHR transport
 * whose Response declares no `body` getter, so the AI SDK's event-source handler
 * hits `response.body == null` and rejects every streaming call as
 * `EmptyResponseBodyError`. `expo/fetch` is the native streaming transport.
 *
 * It takes `(url, init)`, not a Request: `FetchRequestLike` requires a real
 * `body` property, and a whatwg Request has none — handing it one silently sends
 * an empty body. The body is therefore passed explicitly, unserialized, so a
 * non-text body survives.
 */
export function platformFetch(
  request: Request,
  body: BodyInit | null | undefined,
): Promise<Response> {
  return expoFetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    signal: request.signal,
    ...(body !== undefined ? { body } : {}),
  }) as unknown as Promise<Response>
}
