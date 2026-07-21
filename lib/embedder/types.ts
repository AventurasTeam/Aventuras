export type EmbedderBackend = 'local' | 'provider'

/**
 * A local model's dim always comes from the catalog. A provider's is unknown
 * until the first embed call answers it, which is `null` — not 0, which would
 * sit in the same numeric slot as a real dim and silently disable the
 * dim-mismatch guard in the service facade.
 */
export type EmbedderConfig =
  | { backend: 'local'; modelId: string; dim: number }
  | { backend: 'provider'; providerId: string; modelId: string; dim: number | null }

// Init-vs-call split lets consumers distinguish "session never came up"
// (surface at Test Embedder / retry) from "this specific call failed"
// (surface inline, session stays usable). See docs/memory/model-management.md
// -> Embedder failures.
export class EmbedderInitError extends Error {
  readonly kind = 'init'

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'EmbedderInitError'
  }
}

export class EmbedderCallError extends Error {
  readonly kind = 'call'

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'EmbedderCallError'
  }
}

// Ties the envelope's tag to the classes' own, so a third tier can't be added
// to one side of the IPC boundary only.
export type EmbedderErrorKind = EmbedderInitError['kind'] | EmbedderCallError['kind']
