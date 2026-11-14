import type { RollbackCounts, StoryEntryRejection } from '@/lib/actions'

export type RegenerateGate = 'immediate' | 'cascade-confirm' | 'chapter-close-confirm'

type ConfirmPreflightState = {
  startedBranchId: string
  currentBranchId: string
  loadedBranchId: string | null
  dispatchInFlight: boolean
}

type RegeneratePreflightState = ConfirmPreflightState & {
  /** isHeadReversalBlocked for the branch: a pass or a close alone lets a regenerate through. */
  headReversalBlocked: boolean
}

// A confirm opens only on the branch its counts were read for, with none of the reader's dispatches
// running: opened over one, its action could only toast a refusal.
function canContinueConfirmPreflight(args: ConfirmPreflightState): boolean {
  return (
    args.currentBranchId === args.startedBranchId &&
    args.loadedBranchId === args.startedBranchId &&
    !args.dispatchInFlight
  )
}

export function canContinueRegeneratePreflight(args: RegeneratePreflightState): boolean {
  return canContinueConfirmPreflight(args) && !args.headReversalBlocked
}

/** The rollback confirm's counts, or null when the branch or a dispatch moved during the read. */
export async function loadRollbackCountsIfCurrent(
  load: () => Promise<RollbackCounts | StoryEntryRejection>,
  readPreflight: () => ConfirmPreflightState,
): Promise<RollbackCounts | StoryEntryRejection | null> {
  const counts = await load()
  return canContinueConfirmPreflight(readPreflight()) ? counts : null
}

export async function loadRegenerateCountsIfCurrent(
  load: () => Promise<RollbackCounts | StoryEntryRejection>,
  readPreflight: () => RegeneratePreflightState,
): Promise<RollbackCounts | StoryEntryRejection | null> {
  const counts = await load()
  return canContinueRegeneratePreflight(readPreflight()) ? counts : null
}

// entries > 1 ⇔ the reply isn't terminal (system entries and the opening carry no create deltas);
// with one entry in range, a chapter in range ends on that reply (C10).
export function classifyRegenerateGate(
  counts: Pick<RollbackCounts, 'entries' | 'chapters' | 'closeWrites'>,
): RegenerateGate {
  if (counts.entries > 1) return 'cascade-confirm'
  if (counts.chapters > 0 || counts.closeWrites > 0) return 'chapter-close-confirm'
  return 'immediate'
}
