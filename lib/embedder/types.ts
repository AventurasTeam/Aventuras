export type EmbedderBackend = 'local' | 'provider'

export type EmbedderConfig =
  | { backend: 'local'; modelId: string; dim: number }
  | { backend: 'provider'; providerId: string; modelId: string; dim: number }

// Init-vs-call split lets consumers distinguish "session never came up"
// (surface at Test Embedder / retry) from "this specific call failed"
// (surface inline, session stays usable). See docs/memory/model-management.md
// -> Embedder failures.
export class EmbedderInitError extends Error {
  readonly kind = 'init'
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'EmbedderInitError'
    this.cause = cause
  }
}

export class EmbedderCallError extends Error {
  readonly kind = 'call'
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'EmbedderCallError'
    this.cause = cause
  }
}
