import type { RollbackCounts, StoryEntryRejection } from '@/lib/actions'

export type RegenerateGate = 'immediate' | 'cascade-confirm' | 'chapter-close-confirm'

type RegeneratePreflightState = {
  startedBranchId: string
  currentBranchId: string
  loadedBranchId: string | null
  dispatchInFlight: boolean
  /** isHeadReversalBlocked for the branch: a pass or a close alone lets a regenerate through. */
  headReversalBlocked: boolean
}

export function canContinueRegeneratePreflight(args: RegeneratePreflightState): boolean {
  return (
    args.currentBranchId === args.startedBranchId &&
    args.loadedBranchId === args.startedBranchId &&
    !args.dispatchInFlight &&
    !args.headReversalBlocked
  )
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
