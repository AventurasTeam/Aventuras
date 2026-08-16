/**
 * What the host owes the user after a regenerate returns, given the run outcome,
 * whether the follow-up unwind landed, and whether the composer holds a draft.
 *
 * Split from the route so the table is exhaustively testable: the arms differ in
 * whether the user's action text may be offered back at all, and getting that
 * wrong either duplicates their action or silently destroys it.
 */
export type RegenerateOutcomeAction =
  /** Run completed; the new take stands and nothing is owed. */
  | 'none'
  /** The unwind did not land, so the user_action still stands: offer nothing. */
  | 'refuse-unconverged'
  /** Failed run: persist the failure entry carrying the retryable submission. */
  | 'write-failure-entry'
  /** Refused start: same entry, blocked-by copy. */
  | 'write-blocked-entry'
  /** Cancelled into an empty composer: hand the swept action back. */
  | 'restore-draft'
  /** Cancelled over typed text: the draft wins, the swept action is dropped. */
  | 'keep-draft'

export type RegenerateOutcomePlan = {
  action: RegenerateOutcomeAction
  /**
   * Whether entriesStore must be re-hydrated before the user sees the result.
   * True for every non-completed outcome: `converged` is also true when the
   * unwind committed and only its post-commit store sync threw, so any of these
   * arms can be holding rows the DB already dropped.
   */
  resync: boolean
}

export function planRegenerateOutcome(args: {
  outcome: 'completed' | 'failed' | 'rejected' | 'aborted'
  converged: boolean
  draftEmpty: boolean
}): RegenerateOutcomePlan {
  if (args.outcome === 'completed') return { action: 'none', resync: false }
  if (!args.converged) return { action: 'refuse-unconverged', resync: true }
  if (args.outcome === 'failed') return { action: 'write-failure-entry', resync: true }
  if (args.outcome === 'rejected') return { action: 'write-blocked-entry', resync: true }
  return { action: args.draftEmpty ? 'restore-draft' : 'keep-draft', resync: true }
}

/** Whether this arm hands `userActionContent` back to the user in any form. */
export function offersUserAction(action: RegenerateOutcomeAction): boolean {
  return (
    action === 'write-failure-entry' ||
    action === 'write-blocked-entry' ||
    action === 'restore-draft'
  )
}

export function shouldRestoreUserActionAfterHandlingFailure(
  action: RegenerateOutcomeAction,
  draftEmpty: boolean,
): boolean {
  return draftEmpty && offersUserAction(action)
}
