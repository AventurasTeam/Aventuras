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

/**
 * The text a regenerate arm left in the draft or on its own entry, which the dropped entry's
 * hand-back defers to: an arm that offers the action's text settles it once its write landed, or
 * once its failure handling restored the text to the draft.
 */
export function armSettledText(args: {
  action: RegenerateOutcomeAction
  userActionContent: string
  landed: boolean
  restored: boolean
}): string | null {
  return (args.landed || args.restored) && offersUserAction(args.action)
    ? args.userActionContent
    : null
}

/** The branch's newest reply, whose state report the post-turn toast reads. */
export function latestReplyOf<E extends { branchId: string; kind: string; position: number }>(
  entries: Iterable<E>,
  branchId: string,
): E | undefined {
  let latest: E | undefined
  for (const entry of entries) {
    if (entry.branchId !== branchId || entry.kind !== 'ai_reply') continue
    if (latest == null || entry.position > latest.position) latest = entry
  }
  return latest
}

type Submission = { content: string; composerMode: string }

export type BehindTailDrop<T> =
  | { status: 'returned'; value: T }
  | { status: 'threw'; error: unknown; entryDestroyed: boolean }

/**
 * Runs a dispatch behind its tail drop, split at the clear's commit: a clear that throws leaves the
 * entry and its Retry standing, so only a later throw reports the entry's text as owed.
 */
export async function runBehindTailDrop<T>(deps: {
  hasTail: boolean
  clear: () => Promise<void>
  reload: () => Promise<void>
  run: () => Promise<T>
}): Promise<BehindTailDrop<T>> {
  let entryDestroyed = false
  try {
    if (deps.hasTail) {
      await deps.clear()
      entryDestroyed = true
      await deps.reload()
    }
    return { status: 'returned', value: await deps.run() }
  } catch (error) {
    return { status: 'threw', error, entryDestroyed }
  }
}

/**
 * A regenerate's custody of the failure entry its tail drop destroyed (reader-composer.md →
 * Custody of the turn's text): once `settle` has put the arm's own text in the draft or on its
 * entry, the dropped entry's text goes to the draft, unless it is that same text. A throwing
 * `settle` still hands it back before the throw propagates. The rejection arm puts the entry
 * back instead, so it never comes through here.
 */
export async function settleWithDroppedHandback(deps: {
  dropped: Submission | undefined
  /** Resolves to the text the arm left in the draft or on its own entry, or null for none. */
  settle: () => Promise<string | null>
  stillOnBranch: () => boolean
  handBack: (submission: Submission) => void
}): Promise<void> {
  let settled: string | null = null
  try {
    settled = await deps.settle()
  } finally {
    if (deps.dropped != null && deps.dropped.content !== settled && deps.stillOnBranch())
      deps.handBack(deps.dropped)
  }
}

export function shouldRestoreUserActionAfterHandlingFailure(
  action: RegenerateOutcomeAction,
  draftEmpty: boolean,
): boolean {
  return draftEmpty && offersUserAction(action)
}
