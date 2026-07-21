import type { EmbedderErrorEnvelope } from '@/types/embedder-bridge'

import { EmbedderCallError, EmbedderInitError } from '../types'

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
): EmbedderInitError | EmbedderCallError {
  // instanceof can't survive the IPC boundary — the {kind} tag is the contract.
  return envelope.kind === 'init'
    ? new EmbedderInitError(envelope.message)
    : new EmbedderCallError(envelope.message)
}

export async function embedLocal(modelId: string, texts: string[]): Promise<LocalEmbedResult> {
  const result = await resolveBridge().embed({ modelId, texts })
  if (!result.ok) throw envelopeToError(result.error)
  return { vectors: result.vectors.map((v) => Float32Array.from(v)), dim: result.dim }
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
