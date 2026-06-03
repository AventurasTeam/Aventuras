import { httpCallSink } from '@/lib/diagnostics'

type FetchWithCaptureOptions = {
  source: string
  fetchImpl?: typeof fetch
  getActionId?: () => string | undefined
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

async function captureRequestBody(requestClone: Request): Promise<unknown> {
  if (requestClone.body === null) return undefined
  return requestClone.text()
}

function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ?? false
}

export function createFetchWithCapture(options: FetchWithCaptureOptions): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch

  return async (input, init) => {
    const request = new Request(input, init)
    const requestBody = await captureRequestBody(request.clone())
    const actionId = options.getActionId?.()
    const id = httpCallSink.beginCall({
      method: request.method,
      url: request.url,
      requestHeaders: headersToRecord(request.headers),
      requestBody,
      source: options.source,
      ...(actionId !== undefined ? { actionId } : {}),
    })

    try {
      const response = await fetchImpl(request)
      const responseHeaders = headersToRecord(response.headers)

      if (isEventStream(response) && response.body !== null) {
        const captureResponse = response.clone()
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

      const responseBody = await response.clone().text()
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
