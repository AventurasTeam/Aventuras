import type { EmbedderErrorEnvelope } from '@/types/embedder-bridge'

export type EmbedderBackend = 'local' | 'provider'

/**
 * Matryoshka truncation for one provider config, or `null` for native dim.
 *
 * One value rather than a dim field beside a boolean: the two are only ever
 * meaningful together, and "send `dimensions: N` while truncating to something
 * else" — or to nothing — is not a state the embedder has any answer for.
 * `serverSide` additionally sends the provider's `dimensions` param (gated on
 * matryoshkaSupported); client-side truncation runs either way, so correctness
 * never depends on the server honouring it.
 */
export type EmbedderTruncation = { effectiveDim: number; serverSide: boolean }

/**
 * A local model's dim always comes from the catalog. A provider's is unknown
 * until the first embed call answers it, which is `null` — not 0, which would
 * sit in the same numeric slot as a real dim and silently disable the
 * dim-mismatch guard in the service facade.
 */
export type EmbedderConfig =
  | { backend: 'local'; modelId: string; dim: number }
  | {
      backend: 'provider'
      providerId: string
      modelId: string
      dim: number | null
      /** Story-locked Matryoshka truncation; null = native. Local never truncates. */
      truncation: EmbedderTruncation | null
    }

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

/**
 * Not a failure: the user stopped the run, or a bounded signal relayed a stop.
 * Separate from EmbedderCallError so a cancel cannot be handled as a fault by
 * a consumer that only knows the two failure tiers.
 */
export class EmbedderCancelledError extends Error {
  readonly kind = 'cancelled'

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'EmbedderCancelledError'
  }
}

/** Every tier the IPC envelope can carry, cancellation included. */
export type EmbedderOutcomeKind =
  | EmbedderInitError['kind']
  | EmbedderCallError['kind']
  | EmbedderCancelledError['kind']

/**
 * The FAILURE subset. 'cancelled' is deliberately absent: this type is what a
 * probe capture's failure_reason column stores, and a stop the user asked for is
 * not a fault to record as one. Cancellation travels as its own arm on
 * `SyncStageResult` / `RetrievalOutcome` instead.
 */
export type EmbedderErrorKind = Exclude<EmbedderOutcomeKind, 'cancelled'>

/**
 * Bidirectional on purpose: a one-way derivation from the classes constrains
 * nothing, letting the envelope gain a tier on its own and still compile clean.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _envelopeTiersMatchTheClasses: Exact<EmbedderErrorEnvelope['kind'], EmbedderOutcomeKind> =
  true
void _envelopeTiersMatchTheClasses
