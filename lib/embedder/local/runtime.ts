import { logger } from '@/lib/diagnostics'
import type { EmbedderBridge, EmbedderErrorEnvelope } from '@/types/embedder-bridge'

import { abortedEmbedError } from './cancel'
import { EmbedderCallError, EmbedderCancelledError, EmbedderInitError } from '../types'

export type LocalEmbedResult = { vectors: Float32Array[]; dim: number }

function resolveBridge() {
  const bridge = globalThis.window?.aventurasEmbedder
  if (!bridge) {
    throw new EmbedderInitError('Embedder bridge unavailable — Electron preload not loaded.')
  }
  return bridge
}

export function envelopeToError(
  envelope: EmbedderErrorEnvelope,
): EmbedderInitError | EmbedderCallError | EmbedderCancelledError {
  if (envelope.kind === 'cancelled') {
    logger.debug('embedder.local_embed_cancelled', { error: envelope.message })
    // Its own class, so a consumer holding only the two failure tiers cannot
    // handle a stop as a fault.
    return new EmbedderCancelledError(envelope.message)
  }
  logger.error('embedder.local_runtime_failed', {
    kind: envelope.kind,
    error: envelope.message,
  })
  // instanceof can't survive the IPC boundary — the {kind} tag is the contract.
  return envelope.kind === 'init'
    ? new EmbedderInitError(envelope.message)
    : new EmbedderCallError(envelope.message)
}

function unwrapEmbed(result: Awaited<ReturnType<EmbedderBridge['embed']>>): LocalEmbedResult {
  if (!result.ok) throw envelopeToError(result.error)
  return { vectors: result.vectors.map((v) => Float32Array.from(v)), dim: result.dim }
}

export async function embedLocal(
  modelId: string,
  texts: string[],
  signal?: AbortSignal,
): Promise<LocalEmbedResult> {
  const bridge = resolveBridge()
  if (!signal) return unwrapEmbed(await bridge.embed({ modelId, texts }))

  // Classified, not assumed a stop: a bounded signal can expire during
  // runSyncStage's pre-embed queries and arrive here as a pre-flight abort.
  if (signal.aborted) throw abortedEmbedError(signal)
  // Main keys its abort on this id, so a cancel must name the same one; released in
  // the finally — the longer-lived pipeline signal would cancel a retired request.
  const requestId = crypto.randomUUID()
  const onAbort = (): void => {
    void bridge.cancelEmbed({ requestId }).catch((error: unknown) => {
      // Best-effort side channel: the embed fails through the signal anyway, so
      // a dead cancel must not surface as an unattributed unhandled rejection.
      logger.warn('embedder.cancel_embed_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
  signal.addEventListener('abort', onAbort)
  let result
  try {
    result = await bridge.embed({ modelId, texts, requestId })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  // A bounded signal expiring aborts the embed exactly as a user stop does, and
  // main can only see that it was aborted — the reason lives on this side.
  if (!result.ok && result.error.kind === 'cancelled') throw abortedEmbedError(signal)
  return unwrapEmbed(result)
}

export async function smokeTestLocal(modelId: string): Promise<{ dim: number }> {
  const result = await resolveBridge().smokeTest({ modelId })
  if (!result.ok) throw envelopeToError(result.error)
  return { dim: result.dim }
}

export async function listInstalledLocal(): Promise<{ id: string; sizeBytes: number }[]> {
  const installed = await resolveBridge().listInstalled()
  return installed.map(({ id, sizeBytes }) => ({ id, sizeBytes }))
}
