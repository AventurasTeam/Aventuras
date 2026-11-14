import {
  STORY_ENTRY_REJECTION,
  type CountsChangedRejection,
  type RegenerateRejectionCode,
  type RegenerateTurnResult,
  type RollbackCounts,
  type StoryEntryRejection,
} from '@/lib/actions'
import { EMBEDDER_SWAP_REFUSAL } from '@/lib/embedder-swap'

/** An open rollback or regenerate confirm: the entry it reverses to and the counts it shows. */
export type ConfirmState = {
  mode: 'rollback' | 'regenerate'
  targetId: string
  targetNumber: number
  counts: RollbackCounts
  /** The settle count read just before the opener counted; a re-open after a refusal keeps it. */
  countedAtSettle: number
}

export type RegenerateRefusal = Extract<RegenerateTurnResult, { status: 'rejected' }>
export type RollbackRefusal = StoryEntryRejection | CountsChangedRejection

// Copy follows the user's remedy (wait, resume the swap, recheck counts); invariant violations get
// no retry invitation: a retry cannot succeed and would loop.
const REGENERATE_REJECTION_COPY = {
  [EMBEDDER_SWAP_REFUSAL]: 'reader:actions.blockedWhileSwapping',
  'generation-in-flight': 'reader:actions.blockedWhileGenerating',
  [STORY_ENTRY_REJECTION.countsChanged]: 'reader:rollbackCountsChanged',
  'branch-not-loaded': 'reader:regenerateUnavailable',
  'classifier-held': 'reader:regenerateHeld',
  'not-an-ai-reply': 'reader:regenerateUnavailable',
  'no-origin': 'reader:regenerateUnavailable',
  'sweep-refused': 'reader:regenerateUnavailable',
} as const satisfies Record<RegenerateRejectionCode, string>

export function regenerateRefusalCopy(
  refusal: RegenerateRefusal,
): (typeof REGENERATE_REJECTION_COPY)[RegenerateRejectionCode] {
  return REGENERATE_REJECTION_COPY[refusal.code]
}

// A tap has no confirm open for "the counts changed" to refer to: its caller opens one instead.
export function regenerateRefusalToast(
  refusal: RegenerateRefusal,
  origin: 'tap' | 'confirm',
): (typeof REGENERATE_REJECTION_COPY)[RegenerateRejectionCode] | null {
  if (origin === 'tap' && refusal.code === STORY_ENTRY_REJECTION.countsChanged) return null
  return regenerateRefusalCopy(refusal)
}

export function rollbackRefusalCopy(
  refusal: RollbackRefusal,
): 'reader:rollbackCountsChanged' | 'reader:rollbackFailed' {
  return refusal.code === STORY_ENTRY_REJECTION.countsChanged
    ? 'reader:rollbackCountsChanged'
    : 'reader:rollbackFailed'
}

/**
 * The counts a refused confirm re-opens on (rollback-confirm.md → Edge cases): the action's
 * fresh ones on `counts-changed`, else the ones the user confirmed.
 */
export function countsAfterRefusal(
  confirmed: RollbackCounts,
  refusal: RollbackRefusal | RegenerateRefusal,
): RollbackCounts {
  return refusal.code === STORY_ENTRY_REJECTION.countsChanged ? refusal.counts : confirmed
}

/**
 * The confirm once its commit is refused. The confirm's press closed it, so the refusal re-opens
 * it on the same target, unless the user left the branch or opened another confirm since.
 */
export function reopenAfterRefusal(args: {
  current: ConfirmState | null
  confirmed: ConfirmState
  refusal: RollbackRefusal | RegenerateRefusal
  stillOnBranch: boolean
}): ConfirmState | null {
  if (!args.stillOnBranch || args.current != null) return args.current
  return { ...args.confirmed, counts: countsAfterRefusal(args.confirmed.counts, args.refusal) }
}

/** The confirm an immediate regenerate opens when its commit refuses on fresh counts. */
export function confirmAfterImmediateRefusal(args: {
  current: ConfirmState | null
  refusal: RegenerateRefusal
  opened: Pick<ConfirmState, 'targetId' | 'targetNumber' | 'countedAtSettle'>
  stillOnBranch: boolean
}): ConfirmState | null {
  const { current, refusal, opened, stillOnBranch } = args
  if (!stillOnBranch || current != null) return current
  if (refusal.code !== STORY_ENTRY_REJECTION.countsChanged) return current
  return { mode: 'regenerate', ...opened, counts: refusal.counts }
}
