/**
 * FetchInterceptor — intercepts createTimeoutFetch calls in E2E tests.
 *
 * Uses a mutable ref (`_interceptorRef`) so that the hoisted vi.mock factory
 * can read the currently installed interceptor at call time.
 */

export interface CapturedRequest {
  serviceId: string
  url: string
  headers: Record<string, string>
  body: any
}

export type ResponseHandler = (req: CapturedRequest) => Response | Promise<Response>

/** Mutable ref read by the hoisted vi.mock factory in test files. */
export const _interceptorRef: { current: FetchInterceptor | null } = { current: null }

export class FetchInterceptor {
  private handlers = new Map<string, ResponseHandler>()
  private captured = new Map<string, CapturedRequest[]>()

  /**
   * Register a response handler for the given serviceId.
   * Returns `this` for chaining.
   */
  on(serviceId: string, handler: ResponseHandler): this {
    this.handlers.set(serviceId, handler)
    return this
  }

  /**
   * Make this interceptor the active one (sets _interceptorRef.current).
   */
  install(): this {
    _interceptorRef.current = this
    return this
  }

  /**
   * Deactivate this interceptor.
   */
  restore(): void {
    if (_interceptorRef.current === this) {
      _interceptorRef.current = null
    }
  }

  /**
   * Returns a fetch function scoped to a specific serviceId.
   * Called by the mock factory returned by vi.mock.
   */
  createFetchForService(serviceId: string) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()

      let body: any = {}
      if (typeof init?.body === 'string' && init.body.trim()) {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }

      const headers: Record<string, string> = {}
      if (init?.headers) {
        const h = init.headers
        if (h instanceof Headers) {
          h.forEach((v, k) => {
            headers[k] = v
          })
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) {
            headers[k] = v
          }
        } else {
          Object.assign(headers, h)
        }
      }

      const req: CapturedRequest = { serviceId, url, headers, body }

      // Store captured request
      const existing = this.captured.get(serviceId) ?? []
      existing.push(req)
      this.captured.set(serviceId, existing)

      const handler = this.handlers.get(serviceId)
      if (!handler) {
        return new Response(`No handler registered for serviceId: ${serviceId}`, { status: 404 })
      }

      return handler(req)
    }
  }

  /** Returns the first captured request for a serviceId. */
  getRequest(serviceId: string): CapturedRequest {
    const reqs = this.captured.get(serviceId)
    if (!reqs || reqs.length === 0) {
      throw new Error(`No captured requests for serviceId: ${serviceId}`)
    }
    return reqs[0]
  }

  /** Returns all captured requests for a serviceId. */
  getRequests(serviceId: string): CapturedRequest[] {
    return this.captured.get(serviceId) ?? []
  }

  /** Clears all captured requests (useful between test cases). */
  clearRequests(): void {
    this.captured.clear()
  }
}

// ---------------------------------------------------------------------------
// Response builder functions
// ---------------------------------------------------------------------------

/**
 * Returns a handler that streams `text` as OpenAI-compatible SSE chunks.
 * Text is split into word-sized pieces.
 */
export function respondWithStream(text: string): ResponseHandler {
  return (_req: CapturedRequest): Response => {
    const words = text.split(' ')

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        for (const word of words) {
          // Emit a space before each word except the first
          const content = words.indexOf(word) === 0 ? word : ` ${word}`
          const chunk = JSON.stringify({
            id: 'gen-test',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { content },
              },
            ],
          })
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
        }

        // Stop chunk
        const stopChunk = JSON.stringify({
          id: 'gen-test',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })
        controller.enqueue(encoder.encode(`data: ${stopChunk}\n\n`))

        // DONE sentinel
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
}

/**
 * Returns a handler that wraps `data` in an OpenAI chat completion JSON envelope.
 */
export function respondWithJSON(data: unknown): ResponseHandler {
  return (_req: CapturedRequest): Response => {
    const body = JSON.stringify({
      id: 'gen-test',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify(data),
          },
          finish_reason: 'stop',
        },
      ],
      usage: { input_tokens: 0, output_tokens: 0 },
    })

    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/**
 * Returns a handler that produces an OpenAI tool-call response envelope.
 * Useful for services using `generateObject()` via tool calls.
 */
export function respondWithToolCall(name: string, args: unknown): ResponseHandler {
  return (_req: CapturedRequest): Response => {
    const body = JSON.stringify({
      id: 'gen-test',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name,
                  arguments: JSON.stringify(args),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { input_tokens: 0, output_tokens: 0 },
    })

    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/**
 * Returns a handler that responds with a non-200 error response.
 */
export function respondWithError(status: number, message: string): ResponseHandler {
  return (_req: CapturedRequest): Response => {
    return new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
