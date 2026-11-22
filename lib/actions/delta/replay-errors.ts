/** `transaction`: nothing landed. `store-sync`: the DB write landed, the in-memory sync threw. */
export type ReplayFailureStage = 'transaction' | 'store-sync'

/**
 * How a re-run journal ended its group's reversal (generation-pipeline.md → Reverse-replay): written
 * back, or the chapter's close undone with it.
 */
export type JournalOutcome = { journal: 'restored' } | { journal: 'undone'; chapterNumber: number }

type ReplayFailure = { cause: unknown; actionId: string } & (
  | { stage: 'transaction' }
  // Only a committed reversal can have ended a re-run's journal.
  | { stage: 'store-sync'; rerun?: JournalOutcome }
)

export class DeltaReplayError extends Error {
  readonly actionId: string
  readonly stage: ReplayFailureStage
  /** A re-run group's journal outcome, carried when only the store sync after its commit failed. */
  readonly rerun?: JournalOutcome
  constructor(message: string, opts: ReplayFailure) {
    super(message, { cause: opts.cause })
    this.name = 'DeltaReplayError'
    this.actionId = opts.actionId
    this.stage = opts.stage
    if (opts.stage === 'store-sync') this.rerun = opts.rerun
  }

  /** The DB write landed: callers must not retry it as a failed reversal. */
  get committed(): boolean {
    return this.stage === 'store-sync'
  }
}

/** Which integrity state a reversal refused (generation-pipeline.md → Reverse-replay). */
export type IntegrityRefusal = 'write-back' | 'held-in-redo' | 'no-create' | 'pruned-outside-redo'

/** What the pipeline port reads off a DeltaReplayError. */
export type DescribedReplayError = {
  detail: string
  /** The reversal landed and only the store sync failed. */
  committed: boolean
  refusal: IntegrityRefusal | null
  rerun?: JournalOutcome
}

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
