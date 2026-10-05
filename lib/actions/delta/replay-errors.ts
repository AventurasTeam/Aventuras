/** `transaction`: nothing landed. `store-sync`: the DB write landed, the in-memory sync threw. */
export type ReplayFailureStage = 'transaction' | 'store-sync'

export class DeltaReplayError extends Error {
  readonly actionId: string
  readonly stage: ReplayFailureStage
  constructor(
    message: string,
    opts: { cause: unknown; actionId: string; stage: ReplayFailureStage },
  ) {
    super(message, { cause: opts.cause })
    this.name = 'DeltaReplayError'
    this.actionId = opts.actionId
    this.stage = opts.stage
  }

  /** The DB write landed: callers must not retry it as a failed reversal. */
  get committed(): boolean {
    return this.stage === 'store-sync'
  }
}

/** Which integrity state a reversal refused (generation-pipeline.md → Reverse-replay). */
export type IntegrityRefusal = 'write-back' | 'held-in-redo' | 'no-create' | 'pruned-outside-redo'

/** A reversal refused before writing anything, so it never reads as committed. */
export class ReversalIntegrityError extends DeltaReplayError {
  readonly refusal: IntegrityRefusal
  constructor(refusal: IntegrityRefusal, detail: string, actionId: string) {
    const message = `Reversal refused (${refusal}): ${detail}`
    // describeDeltaReplayError reports the cause, so it carries the refusal kind too.
    super(message, { cause: message, actionId, stage: 'transaction' })
    this.name = 'ReversalIntegrityError'
    this.refusal = refusal
  }
}
