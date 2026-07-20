// types/embedder-bridge.d.ts — renderer + global Window augmentation for the
// preload-exposed embedder bridge.
// (Electron main/preload get their own copy in electron/embedder/types.ts — the
// two compile units are separate tsconfigs, so the duplication is intentional and
// mirrors types/db-bridge.d.ts.)
export type EmbedderErrorEnvelope = { kind: 'init' | 'call'; message: string }

export type EmbedderInstalled = { id: string; sizeBytes: number; installedAt: number }

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
  embeddersRoot(): Promise<string>
}

declare global {
  interface Window {
    aventurasEmbedder?: EmbedderBridge
  }
}

export {}
