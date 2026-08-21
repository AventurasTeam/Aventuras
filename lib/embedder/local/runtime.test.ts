import { afterEach, describe, expect, it, vi } from 'vitest'

import { boundedSignal } from '@/lib/abort'
import { logger } from '@/lib/diagnostics'
import type { EmbedderBridge } from '@/types/embedder-bridge'

import { embedLocal, envelopeToError } from './runtime'
import { EmbedderCallError, EmbedderCancelledError, EmbedderInitError } from '../types'

type EmbedArgs = Parameters<EmbedderBridge['embed']>[0]
type EmbedResult = Awaited<ReturnType<EmbedderBridge['embed']>>
type BridgeStub = Pick<EmbedderBridge, 'embed' | 'cancelEmbed'>

// A CALL failure whose message merely reads like a cancel — named for its envelope
// tier so these tests aren't misread as cancel coverage.
const CALL_FAILED: EmbedResult = {
  ok: false,
  error: { kind: 'call', message: 'embed cancelled' },
}
// Both values round-trip through Float32Array exactly, so the assertion can
// name them literally.
const ONE_VECTOR: EmbedResult = { ok: true, vectors: [[0.5, -0.25]], dim: 2 }

function stubBridge(bridge: BridgeStub): void {
  vi.stubGlobal('window', { aventurasEmbedder: bridge })
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection, got a resolved value')
    },
    (error: unknown) => error,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('envelopeToError', () => {
  it('maps kind "init" to EmbedderInitError, preserving the message', () => {
    const error = envelopeToError({ kind: 'init', message: 'session never came up' })
    expect(error).toBeInstanceOf(EmbedderInitError)
    expect(error.message).toBe('session never came up')
  })

  it('maps kind "call" to EmbedderCallError, preserving the message', () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const error = envelopeToError({ kind: 'call', message: 'run failed' })

    expect(error).toBeInstanceOf(EmbedderCallError)
    expect(error.message).toBe('run failed')
    expect(logError).toHaveBeenCalledWith('embedder.local_runtime_failed', expect.anything())
  })

  it('maps kind "cancelled" to its own class, without an error-level entry', () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const logDebug = vi.spyOn(logger, 'debug').mockImplementation(() => {})

    const error = envelopeToError({ kind: 'cancelled', message: 'embed cancelled' })

    // Its own class, not EmbedderCallError: the sync stage reads the difference to
    // return a cancelled arm, so a consumer can't handle a user stop as a fault.
    expect(error).toBeInstanceOf(EmbedderCancelledError)
    expect(logError).not.toHaveBeenCalled()
    expect(logDebug).toHaveBeenCalledWith('embedder.local_embed_cancelled', expect.anything())
  })
})

describe('embedLocal cancel vs timeout', () => {
  // Cancel and timeout both reach main as a bare aborted signal, so both come back in
  // this envelope; only the renderer tells them apart, and confusing them hides a fault.
  const CANCELLED: EmbedResult = {
    ok: false,
    error: { kind: 'cancelled', message: 'embed cancelled' },
  }

  it('logs a user cancel at debug and never at error', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const logDebug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    const controller = new AbortController()
    const bounded = boundedSignal(controller.signal, 60_000)
    stubBridge({
      embed: vi.fn(async (_args: EmbedArgs) => {
        controller.abort()
        return CANCELLED
      }),
      cancelEmbed: vi.fn(async () => undefined),
    })

    const error = await rejectionOf(embedLocal('model-a', ['a text'], bounded.signal))
    bounded.dispose()

    expect(error).toBeInstanceOf(EmbedderCancelledError)
    expect(logError).not.toHaveBeenCalled()
    expect(logDebug).toHaveBeenCalledWith('embedder.local_embed_cancelled', expect.anything())
  })

  it('logs an expired bound at error, as the provider fault it is', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const logDebug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    // Expires while the bridge call is outstanding, which is the real ordering:
    // the embed is already in flight when the bound runs out.
    const bounded = boundedSignal(undefined, 1)
    stubBridge({
      embed: vi.fn(async (_args: EmbedArgs) => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return CANCELLED
      }),
      cancelEmbed: vi.fn(async () => undefined),
    })

    const error = await rejectionOf(embedLocal('model-a', ['a text'], bounded.signal))
    bounded.dispose()

    expect(error).toBeInstanceOf(EmbedderCallError)
    expect((error as EmbedderCallError).message).toBe('embed timed out')
    expect(logDebug).not.toHaveBeenCalledWith('embedder.local_embed_cancelled', expect.anything())
    expect(logError).toHaveBeenCalledWith('embedder.local_runtime_failed', expect.anything())
  })
})

describe('embedLocal', () => {
  it('sends no requestId when no signal could ask for a cancel', async () => {
    const embed = vi.fn(async (_args: EmbedArgs) => ONE_VECTOR)
    const cancelEmbed = vi.fn(async () => undefined)
    stubBridge({ embed, cancelEmbed })

    const result = await embedLocal('model-a', ['a text'])

    expect(embed).toHaveBeenCalledWith({ modelId: 'model-a', texts: ['a text'] })
    expect(result.dim).toBe(2)
    expect(Array.from(result.vectors[0])).toEqual([0.5, -0.25])
  })

  it('refuses an already-aborted signal without reaching the bridge', async () => {
    const embed = vi.fn(async (_args: EmbedArgs) => ONE_VECTOR)
    const cancelEmbed = vi.fn(async () => undefined)
    stubBridge({ embed, cancelEmbed })

    const error = await rejectionOf(embedLocal('model-a', ['a text'], AbortSignal.abort()))

    expect(error).toBeInstanceOf(EmbedderCancelledError)
    expect((error as Error).message).toBe('embed cancelled')
    expect(embed).not.toHaveBeenCalled()
  })

  // runSyncStage lists tables and queries a family per kind before the embed, so a
  // bound can expire in that window; read as a user cancel it retries a dead provider.
  it('reports a bound that expired before the embed as a timeout', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const embed = vi.fn(async (_args: EmbedArgs) => ONE_VECTOR)
    const cancelEmbed = vi.fn(async () => undefined)
    stubBridge({ embed, cancelEmbed })
    const bounded = boundedSignal(undefined, 0)
    await new Promise((resolve) => setTimeout(resolve, 5))

    const error = await rejectionOf(embedLocal('model-a', ['a text'], bounded.signal))

    expect((error as Error).message).toBe('embed timed out')
    expect(embed).not.toHaveBeenCalled()
    expect(errorLog).toHaveBeenCalledWith('embedder.local_runtime_failed', {
      kind: 'call',
      error: 'embed timed out',
    })
    bounded.dispose()
    errorLog.mockRestore()
  })

  it('cancels under the same requestId the embed was sent with', async () => {
    const controller = new AbortController()
    let sentRequestId: string | undefined
    const cancelEmbed = vi.fn(async () => undefined)
    const embed = vi.fn(async (args: EmbedArgs) => {
      sentRequestId = args.requestId
      controller.abort()
      return CALL_FAILED
    })
    stubBridge({ embed, cancelEmbed })

    const error = await rejectionOf(embedLocal('model-a', ['a text'], controller.signal))

    expect(error).toBeInstanceOf(EmbedderCallError)
    expect((error as Error).message).toBe('embed cancelled')
    expect(sentRequestId).toEqual(expect.stringMatching(/\S/))
    // Any other id names a controller main does not hold, so the embed runs on.
    expect(cancelEmbed).toHaveBeenCalledWith({ requestId: sentRequestId })
  })

  it('releases the abort listener once the embed resolves', async () => {
    const controller = new AbortController()
    const cancelEmbed = vi.fn(async () => undefined)
    const embed = vi.fn(async (_args: EmbedArgs) => ONE_VECTOR)
    stubBridge({ embed, cancelEmbed })

    await embedLocal('model-a', ['a text'], controller.signal)
    controller.abort()

    expect(cancelEmbed).not.toHaveBeenCalled()
  })

  it('logs a failing cancel rather than leaking an unhandled rejection', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const controller = new AbortController()
    const cancelEmbed = vi.fn(async () => {
      throw new Error('bridge closed')
    })
    const embed = vi.fn(async (_args: EmbedArgs) => {
      controller.abort()
      return CALL_FAILED
    })
    stubBridge({ embed, cancelEmbed })

    await rejectionOf(embedLocal('model-a', ['a text'], controller.signal))
    await Promise.resolve()

    expect(warn).toHaveBeenCalledWith('embedder.cancel_embed_failed', { error: 'bridge closed' })
  })
})
