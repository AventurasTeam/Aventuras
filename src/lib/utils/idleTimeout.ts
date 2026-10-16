import { RequestTimeoutError } from '#lib/utils/error.ts'

interface IdleTimeoutOptions {
  timeoutMs: number
  what?: string
  /** A read that fails after this signal aborted is reported as an `AbortError`. */
  callerSignal?: AbortSignal | null
  abort: () => void
  /** Runs once when the body closes, errors or is cancelled (or at once if there is none). */
  onSettled: () => void
}

/**
 * Re-wraps `response` so its body errors with a `RequestTimeoutError` when no chunk arrives within
 * `timeoutMs`. The timer runs only while a read is waiting on upstream, never while the consumer is slow.
 */
export function withIdleTimeout(response: Response, options: IdleTimeoutOptions): Response {
  const { timeoutMs, what, callerSignal, abort, onSettled } = options
  const source = response.body
  if (!source) {
    onSettled()
    return response
  }

  const reader = source.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  // Set once the stream is closed, errored or cancelled; a read still in flight must not touch it.
  let ended = false

  const settle = () => {
    clearTimeout(timer)
    if (ended) return
    ended = true
    onSettled()
  }

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        timer = setTimeout(() => {
          settle()
          abort()
          // The plugin has usually errored its stream by now, so the cancel rejects.
          reader.cancel().catch(() => {})
          controller.error(new RequestTimeoutError(timeoutMs, what))
        }, timeoutMs)

        try {
          const { done, value } = await reader.read()
          clearTimeout(timer)
          if (ended) return
          if (done) {
            settle()
            controller.close()
          } else {
            controller.enqueue(value)
          }
        } catch (error) {
          if (ended) return
          settle()
          // The plugin rejects an abort with a bare string.
          controller.error(
            callerSignal?.aborted ? new DOMException('Request aborted', 'AbortError') : error,
          )
        }
      },
      async cancel(reason) {
        settle()
        await reader.cancel(reason).catch(() => {})
      },
      // Zero keeps `pull` from running before the first read, so the timer never starts unread.
    },
    { highWaterMark: 0 },
  )

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
