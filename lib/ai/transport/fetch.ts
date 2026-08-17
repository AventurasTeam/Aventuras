import { httpCallSink } from '@/lib/diagnostics'

import { platformFetch } from './platform-fetch'

type FetchWithCaptureOptions = {
  source: string
  fetchImpl?: typeof fetch
  actionId?: string
}

// Statuses whose Response must not carry a body, so a rebuild can't pass one.
const BODYLESS_STATUSES = new Set([204, 205, 304])

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

async function captureRequestBody(requestClone: Request): Promise<string | undefined> {
  if (requestClone.body === null) return undefined
  return requestClone.text()
}

function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ?? false
}

// expo/fetch's FetchResponse.clone() throws 'Not implemented', so capture can't
// assume a second readable copy exists. Probing beats a platform flag: the answer
// is a property of the response we were handed, not of the bundle we're in.
function cloneOrNull(response: Response): Response | null {
  try {
    return response.clone()
  } catch {
    return null
  }
}

function rebuildResponse(body: string, from: Response): Response {
  return new Response(BODYLESS_STATUSES.has(from.status) ? null : body, {
    status: from.status,
    statusText: from.statusText,
    headers: from.headers,
  })
}

export function createFetchWithCapture(options: FetchWithCaptureOptions): typeof fetch {
  const { fetchImpl } = options

  return async (input, init) => {
    const request = new Request(input, init)
    const requestBody = await captureRequestBody(request.clone())
    const { actionId } = options
    const id = httpCallSink.beginCall({
      method: request.method,
      url: request.url,
      requestHeaders: headersToRecord(request.headers),
      requestBody,
      source: options.source,
      ...(actionId !== undefined ? { actionId } : {}),
    })

    try {
      // The raw init body, not the captured text: a transport that re-sends the
      // body itself must not round-trip a non-text one through `.text()`. Falls
      // back to the captured text only when the caller passed a Request.
      const outgoingBody = init?.body !== undefined ? init.body : requestBody
      const response =
        fetchImpl !== undefined
          ? await fetchImpl(request)
          : await platformFetch(request, outgoingBody)
      const responseHeaders = headersToRecord(response.headers)

      // `!= null`, not `!== null`: whatwg-fetch leaves body undefined rather than
      // null, and treating that as a live stream sends an unreadable response
      // down the streaming branch.
      if (isEventStream(response) && response.body != null) {
        const captureResponse = cloneOrNull(response)
        if (captureResponse === null) {
          // Native streaming transport: the body is the SDK's to consume, and
          // teeing it would put a shim in every provider call. Headers and status
          // are still captured; the body is not.
          httpCallSink.completeCall(id, {
            status: response.status,
            responseHeaders,
            streamed: true,
          })
          return response
        }

        void (async () => {
          try {
            const responseBody = await captureResponse.text()
            httpCallSink.completeCall(id, {
              status: response.status,
              responseHeaders,
              responseBody,
              streamed: true,
            })
          } catch (err) {
            httpCallSink.failCall(id, String(err))
          }
        })()

        return response
      }

      const captureResponse = cloneOrNull(response)
      if (captureResponse === null) {
        // No second copy available, so consume the original and hand the caller a
        // rebuilt one — non-streaming handlers only ever read text/json.
        const responseBody = await response.text()
        httpCallSink.completeCall(id, {
          status: response.status,
          responseHeaders,
          responseBody,
          streamed: false,
        })
        return rebuildResponse(responseBody, response)
      }

      const responseBody = await captureResponse.text()
      httpCallSink.completeCall(id, {
        status: response.status,
        responseHeaders,
        responseBody,
        streamed: false,
      })

      return response
    } catch (err) {
      httpCallSink.failCall(id, String(err))
      throw err
    }
  }
}
