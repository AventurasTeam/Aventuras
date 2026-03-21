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

export interface ResponseHandler {
  (req: CapturedRequest): Response | Promise<Response>
  __mockData?: unknown
}

interface TracerNotifiable {
  onRequest(serviceId: string, request: CapturedRequest, mockData: unknown): void
}

/** Mutable ref read by the hoisted vi.mock factory in test files. */
export const _interceptorRef: { current: FetchInterceptor | null } = { current: null }

export class FetchInterceptor {
  private handlers = new Map<string, ResponseHandler>()
  private captured = new Map<string, CapturedRequest[]>()
  private tracer: TracerNotifiable | null = null

  connectTracer(tracer: TracerNotifiable): void {
    this.tracer = tracer
  }

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

      // Notify tracer before calling handler (snapshots stores at this boundary)
      if (this.tracer) {
        this.tracer.onRequest(serviceId, req, handler.__mockData)
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
// Helpers
// ---------------------------------------------------------------------------

/** True when the intercepted URL targets the OpenAI Responses API. */
function isResponsesApi(url: string): boolean {
  return url.includes('/responses')
}

// ---------------------------------------------------------------------------
// Response builder functions
// ---------------------------------------------------------------------------

/**
 * Returns a handler that streams `text` as OpenAI-compatible SSE chunks.
 * Auto-detects Responses API vs Chat Completions API based on request URL.
 * Text is split into word-sized pieces.
 */
export function respondWithStream(text: string): ResponseHandler {
  const handler: ResponseHandler = (req: CapturedRequest): Response => {
    if (isResponsesApi(req.url)) {
      return buildResponsesApiStream(text)
    }
    return buildChatCompletionsStream(text)
  }
  handler.__mockData = { type: 'stream', text }
  return handler
}

/** Build an SSE stream in the OpenAI Responses API format. */
function buildResponsesApiStream(text: string): Response {
  const words = text.split(' ')
  const itemId = 'msg_test_001'
  const responseId = 'resp_test_001'

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const emit = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // 1. response.created
      emit({
        type: 'response.created',
        response: {
          id: responseId,
          created_at: Math.floor(Date.now() / 1000),
          model: 'gpt-4o-mini',
          service_tier: null,
        },
      })

      // 2. output_item.added (message)
      emit({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: itemId },
      })

      // 3. text deltas
      for (let i = 0; i < words.length; i++) {
        const delta = i === 0 ? words[i] : ` ${words[i]}`
        emit({
          type: 'response.output_text.delta',
          item_id: itemId,
          delta,
        })
      }

      // 4. response.completed
      emit({
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 10,
            output_tokens: words.length,
            input_tokens_details: null,
            output_tokens_details: null,
          },
          service_tier: null,
          incomplete_details: null,
        },
      })

      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/** Build an SSE stream in the classic Chat Completions API format. */
function buildChatCompletionsStream(text: string): Response {
  const words = text.split(' ')

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      for (let i = 0; i < words.length; i++) {
        const content = i === 0 ? words[i] : ` ${words[i]}`
        const chunk = JSON.stringify({
          id: 'gen-test',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content } }],
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

/**
 * Returns a handler that wraps `data` in an OpenAI response envelope.
 * Auto-detects Responses API vs Chat Completions API based on request URL.
 */
export function respondWithJSON(data: unknown): ResponseHandler {
  const handler: ResponseHandler = (req: CapturedRequest): Response => {
    if (isResponsesApi(req.url)) {
      return buildResponsesApiJSON(JSON.stringify(data))
    }
    return buildChatCompletionsJSON(JSON.stringify(data))
  }
  handler.__mockData = { type: 'json', data }
  return handler
}

function buildResponsesApiJSON(content: string): Response {
  const body = JSON.stringify({
    id: 'resp_test_001',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    status: 'completed',
    output: [
      {
        type: 'message',
        id: 'msg_test_001',
        role: 'assistant',
        content: [{ type: 'output_text', text: content, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      input_tokens_details: null,
      output_tokens_details: null,
    },
    service_tier: null,
    incomplete_details: null,
  })

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function buildChatCompletionsJSON(content: string): Response {
  const body = JSON.stringify({
    id: 'gen-test',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
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

/**
 * Returns a handler that produces an OpenAI tool-call response envelope.
 * Auto-detects Responses API vs Chat Completions API based on request URL.
 * Useful for services using `generateObject()` via tool calls.
 */
export function respondWithToolCall(name: string, args: unknown): ResponseHandler {
  const handler: ResponseHandler = (req: CapturedRequest): Response => {
    if (isResponsesApi(req.url)) {
      return buildResponsesApiToolCall(name, args)
    }
    return buildChatCompletionsToolCall(name, args)
  }
  handler.__mockData = { type: 'tool_call', name, args }
  return handler
}

function buildResponsesApiToolCall(name: string, args: unknown): Response {
  const body = JSON.stringify({
    id: 'resp_test_001',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    status: 'completed',
    output: [
      {
        type: 'function_call',
        id: 'fc_test_001',
        call_id: 'call-1',
        name,
        arguments: JSON.stringify(args),
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      input_tokens_details: null,
      output_tokens_details: null,
    },
    service_tier: null,
    incomplete_details: null,
  })

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function buildChatCompletionsToolCall(name: string, args: unknown): Response {
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

/**
 * Returns a handler that responds with a non-200 error response.
 */
export function respondWithError(status: number, message: string): ResponseHandler {
  const handler: ResponseHandler = (_req: CapturedRequest): Response => {
    return new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  handler.__mockData = { type: 'error', status, message }
  return handler
}
