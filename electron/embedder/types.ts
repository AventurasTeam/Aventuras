// 'cancelled' is a deliberate stop, not a fault: it keeps a user pressing Cancel
// out of the error-level diagnostics a real embedder failure writes.
export type EmbedderErrorEnvelope = { kind: 'init' | 'call' | 'cancelled'; message: string }

export type EmbedderDownloadReason =
  | 'hash-mismatch'
  | 'network'
  | 'disk'
  | 'invalid-request'
  | 'cancelled'

export type EmbedderInstalled = { id: string; sizeBytes: number; installedAt: number }

export type EmbedderAttestation = {
  timestamp: number
  licenseSha256: string
  sourceUrl: string
  revision: string
}

export type EmbedderDownloadProgress = {
  modelId: string
  fileName: string
  bytesReceived: number
  bytesTotal: number
}

// Every method keys on `modelId`, never a caller-supplied path: main resolves the
// directory itself so a compromised renderer can't name one.
export type EmbedderBridge = {
  embed(args: {
    modelId: string
    texts: string[]
    /** Handle for `cancelEmbed`. Omitted means the run cannot be cancelled. */
    requestId?: string
  }): Promise<
    { ok: true; vectors: number[][]; dim: number } | { ok: false; error: EmbedderErrorEnvelope }
  >
  smokeTest(args: {
    modelId: string
  }): Promise<{ ok: true; dim: number } | { ok: false; error: EmbedderErrorEnvelope }>
  listInstalled(): Promise<EmbedderInstalled[]>
  downloadFile(args: {
    url: string
    modelId: string
    fileName: string
    expectedSha256: string
  }): Promise<{ ok: true } | { ok: false; reason: EmbedderDownloadReason; message: string }>
  persistInstall(args: {
    modelId: string
    licenseText: string
    attestation: EmbedderAttestation
  }): Promise<void>
  cancelDownload(args: { modelId: string }): Promise<void>
  /** Cancels at the embed's next chunk boundary; a completed or unknown
   *  `requestId` is a no-op. */
  cancelEmbed(args: { requestId: string }): Promise<void>
  deletePartial(args: { modelId: string }): Promise<void>
  onDownloadProgress(cb: (progress: EmbedderDownloadProgress) => void): () => void
}
