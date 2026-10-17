import { describe, it, expect, vi, afterEach } from 'vitest'
import { RequestTimeoutError } from '#lib/utils/error.ts'
import { createRequestGuard, withIdleTimeout } from './idleTimeout'
import { firstReadError } from './idleTimeout.testing'

const bytes = (text: string) => new TextEncoder().encode(text)

/** A body the test drives by hand, like the plugin's. */
function source() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
    cancel,
  })
  return { response: new Response(stream, { status: 200 }), controller, cancel }
}

function wrap(response: Response, extra: { callerSignal?: AbortSignal } = {}) {
  const abort = vi.fn()
  const onSettled = vi.fn()
  const wrapped = withIdleTimeout(response, { timeoutMs: 1_000, abort, onSettled, ...extra })
  return { wrapped, abort, onSettled }
}

describe('withIdleTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes chunks through and re-arms the timer on each', async () => {
    vi.useFakeTimers()
    const { response, controller } = source()
    const { wrapped, abort, onSettled } = wrap(response)
    const reader = wrapped.body!.getReader()

    for (const text of ['a', 'b', 'c']) {
      await vi.advanceTimersByTimeAsync(900)
      controller.enqueue(bytes(text))
      const { value } = await reader.read()
      expect(new TextDecoder().decode(value)).toBe(text)
    }

    expect(abort).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('arms no timer until the first read', async () => {
    vi.useFakeTimers()
    const { response } = source()
    const { wrapped } = wrap(response)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(vi.getTimerCount()).toBe(0)

    const read = firstReadError(wrapped)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await read).toBeInstanceOf(RequestTimeoutError)
  })

  it('keeps the response status and headers', () => {
    const response = new Response('x', { status: 429, headers: { 'retry-after': '3' } })
    const { wrapped } = wrap(response)

    expect(wrapped.status).toBe(429)
    expect(wrapped.headers.get('retry-after')).toBe('3')
  })

  it('errors the stream with a RequestTimeoutError and aborts the request on a stall', async () => {
    vi.useFakeTimers()
    const { response, cancel } = source()
    const { wrapped, abort, onSettled } = wrap(response)
    const read = firstReadError(wrapped)

    await vi.advanceTimersByTimeAsync(1_000)

    const error = await read
    expect(error).toBeInstanceOf(RequestTimeoutError)
    expect(error).toMatchObject({ message: 'Request timed out after 1s' })
    expect(abort).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer and settles once when the body closes', async () => {
    vi.useFakeTimers()
    const { response, controller } = source()
    const { wrapped, abort, onSettled } = wrap(response)
    const reader = wrapped.body!.getReader()

    controller.enqueue(bytes('a'))
    await reader.read()
    controller.close()
    expect((await reader.read()).done).toBe(true)

    expect(vi.getTimerCount()).toBe(0)
    expect(onSettled).toHaveBeenCalledOnce()
    expect(abort).not.toHaveBeenCalled()
  })

  it('clears the timer, cancels the source and settles once on cancel', async () => {
    vi.useFakeTimers()
    const { response, cancel } = source()
    const { wrapped, onSettled } = wrap(response)
    const reader = wrapped.body!.getReader()
    const pending = reader.read()

    await reader.cancel('stop')

    expect((await pending).done).toBe(true)
    expect(cancel).toHaveBeenCalledWith('stop')
    expect(vi.getTimerCount()).toBe(0)
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('errors with an AbortError when the read fails after the caller aborted', async () => {
    const { response, controller } = source()
    const caller = new AbortController()
    const { wrapped, onSettled } = wrap(response, { callerSignal: caller.signal })
    const read = firstReadError(wrapped)

    caller.abort()
    controller.error('Request cancelled')

    expect(await read).toMatchObject({ name: 'AbortError' })
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('passes any other read error through unchanged', async () => {
    const { response, controller } = source()
    const { wrapped } = wrap(response, { callerSignal: new AbortController().signal })
    const read = firstReadError(wrapped)

    controller.error('connection reset')

    expect(await read).toBe('connection reset')
  })

  it('returns a response without a body as is and settles at once', () => {
    const response = new Response(null, { status: 204 })
    const { wrapped, onSettled } = wrap(response)

    expect(wrapped).toBe(response)
    expect(onSettled).toHaveBeenCalledOnce()
  })
})

describe('createRequestGuard', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('removes the caller listener on dispose when the body was never wrapped', () => {
    const caller = new AbortController()
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    const guard = createRequestGuard({ timeoutMs: 1_000, callerSignal: caller.signal })

    guard.dispose()

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('keeps the caller listener while a wrapped body is live and drops it once it closes', async () => {
    const caller = new AbortController()
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    const guard = createRequestGuard({ timeoutMs: 1_000, callerSignal: caller.signal })
    const { response, controller } = source()

    const wrapped = guard.wrapBody(response)
    guard.dispose()
    expect(remove).not.toHaveBeenCalled()

    controller.close()
    await wrapped.text()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('clears the header timer on dispose', () => {
    vi.useFakeTimers()
    const guard = createRequestGuard({ timeoutMs: 1_000 })

    guard.dispose()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts at once for a caller signal that is already aborted', () => {
    const caller = new AbortController()
    caller.abort()
    const guard = createRequestGuard({ timeoutMs: 1_000, callerSignal: caller.signal })

    expect(guard.signal.aborted).toBe(true)
    expect(guard.mapError('Request cancelled')).toMatchObject({ name: 'AbortError' })
    guard.dispose()
  })

  it('maps a header timeout to a RequestTimeoutError', async () => {
    vi.useFakeTimers()
    const guard = createRequestGuard({ timeoutMs: 5_000, what: 'Image fetch' })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(guard.signal.aborted).toBe(true)
    const error = guard.mapError('Request canceled')
    expect(error).toBeInstanceOf(RequestTimeoutError)
    expect(error).toMatchObject({ message: 'Image fetch timed out after 5s' })
    guard.dispose()
  })

  it('maps a caller abort to an AbortError and aborts the request', () => {
    const caller = new AbortController()
    const guard = createRequestGuard({ timeoutMs: 1_000, callerSignal: caller.signal })

    caller.abort()

    expect(guard.signal.aborted).toBe(true)
    expect(guard.mapError('Request canceled')).toMatchObject({ name: 'AbortError' })
    guard.dispose()
  })

  it('passes any other error through unchanged', () => {
    const guard = createRequestGuard({ timeoutMs: 1_000 })
    const failure = new Error('connection refused')

    expect(guard.mapError(failure)).toBe(failure)
    guard.dispose()
  })
})
