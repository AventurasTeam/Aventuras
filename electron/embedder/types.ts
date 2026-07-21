export type EmbedderErrorEnvelope = { kind: 'init' | 'call'; message: string }

export type EmbedderDownloadReason = 'hash-mismatch' | 'network' | 'disk'

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

export type EmbedderBridge = {
  embed(args: {
    modelDir: string
    texts: string[]
  }): Promise<
    { ok: true; vectors: number[][]; dim: number } | { ok: false; error: EmbedderErrorEnvelope }
  >
  smokeTest(args: {
    modelDir: string
  }): Promise<{ ok: true; dim: number } | { ok: false; error: EmbedderErrorEnvelope }>
  listInstalled(): Promise<EmbedderInstalled[]>
  downloadFile(args: {
    url: string
    modelId: string
    fileName: string
    expectedSha256: string | null
  }): Promise<{ ok: true } | { ok: false; reason: EmbedderDownloadReason; message: string }>
  persistInstall(args: {
    modelId: string
    licenseText: string
    attestation: EmbedderAttestation
  }): Promise<void>
  deletePartial(args: { modelId: string }): Promise<void>
  embeddersRoot(): Promise<string>
  onDownloadProgress(cb: (progress: EmbedderDownloadProgress) => void): () => void
}
