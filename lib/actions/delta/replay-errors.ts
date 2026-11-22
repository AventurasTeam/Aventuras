/** `transaction`: nothing landed. `store-sync`: the DB write landed, the in-memory sync threw. */
export type ReplayFailureStage = 'transaction' | 'store-sync'

/** How a re-run journal ended its group's reversal (generation-pipeline.md → Reverse-replay). */
export type JournalOutcome = 'restored' | 'undone'

export class DeltaReplayError extends Error {
  readonly actionId: string
  readonly stage: ReplayFailureStage
  /** A re-run group's journal outcome, carried when only the store sync after its commit failed. */
  readonly journal?: JournalOutcome
  /** The chapter an `undone` outcome names; null when no chapter row was left. */
  readonly chapterNumber?: number | null
  constructor(
    message: string,
    opts: {
      cause: unknown
      actionId: string
      stage: ReplayFailureStage
      journal?: JournalOutcome
      chapterNumber?: number | null
    },
  ) {
    super(message, { cause: opts.cause })
    this.name = 'DeltaReplayError'
    this.actionId = opts.actionId
    this.stage = opts.stage
    this.journal = opts.journal
    this.chapterNumber = opts.chapterNumber
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
