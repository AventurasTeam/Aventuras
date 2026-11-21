import type {
  GroupOutcome,
  IntegrityRefusal,
  MutationResult,
  PipelineAction,
  RowGuard,
  RowGuardArgs,
} from '@/lib/actions/types'
import type { DbCtx, SqlOp } from '@/lib/db'

export type DeltaActionPort = {
  applyDeltaAction: (
    args: { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null },
    ctx: DbCtx,
  ) => Promise<MutationResult>
  /** One transaction for the group; each action's outcome at its index, a refusal as a value (C11). */
  applyDeltaActionGroupWithOutcomes: (
    actions: readonly PipelineAction[],
    args: { actionId: string; branchId: string; entryId: string },
    ctx: DbCtx,
  ) => Promise<GroupOutcome>
  /** C12 and user precedence for the listed rows, read once. */
  readRowGuard: (args: RowGuardArgs, ctx: DbCtx) => Promise<RowGuard>
  /** Whether the user deleted any of the happening's link rows after the prose. */
  userDeletedHappeningLink: (
    args: { branchId: string; happeningId: string; proseEntryId: string },
    ctx: Pick<DbCtx, 'db'>,
  ) => Promise<boolean>
  reverseReplayDeltas: (
    actionId: string,
    ctx: DbCtx,
    settleOps?: (deltaCount: number) => readonly SqlOp[],
  ) => Promise<number>
  /**
   * Reverses a run's group; a close's re-run writes its journal back or undoes the close.
   * `settleOps` hears whether anything was reversed or written back.
   */
  reverseRunGroup: (
    args: { actionId: string; branchId: string | null; rerunChapterId?: string | null },
    ctx: DbCtx,
    settleOps?: (reversed: boolean) => readonly SqlOp[],
  ) => Promise<{
    deltas: number
    journal: 'restored' | 'undone' | null
    chapterNumber: number | null
  }>
  // Undefined for anything but a DeltaReplayError. `committed`: the reversal landed, only the store
  // sync failed (a re-run's then carries `journal`/`chapterNumber`); `refusal`: integrity refusal.
  describeReplayError: (e: unknown) =>
    | {
        detail: string
        committed: boolean
        refusal: IntegrityRefusal | null
        journal?: 'restored' | 'undone'
        chapterNumber?: number | null
      }
    | undefined
  /** Resolves once every user write dispatched so far has committed or been refused. */
  settleUserWrites: () => Promise<void>
  /** Takes the branch write lock exclusive for `actionId`; idempotent per actionId, never rejects. */
  holdBranchWriteExclusive: (branchId: string, actionId: string) => Promise<void>
  /** Ends `actionId`'s exclusive hold, or drops its queued request; else a no-op. */
  releaseBranchWriteExclusive: (branchId: string, actionId: string) => void
  /**
   * Reverses the chapter's lore work for its re-run and journals it in one transaction; returns
   * the floor. The caller holds the branch exclusive.
   */
  reverseCloseForRerun: (
    args: { branchId: string; chapterId: string; actionId: string },
    ctx: DbCtx,
  ) => Promise<{ floor: number }>
}

let port: DeltaActionPort | undefined

// @/lib/actions (submit-turn) imports @/lib/pipeline to trigger runs, so
// lib/pipeline must not import @/lib/actions directly — that would close a
// require cycle. The real functions are wired in once at boot
// (lib/boot/bootstrap.ts).
export function configureDeltaActionPort(p: DeltaActionPort): void {
  port = p
}

function requirePort(): DeltaActionPort {
  if (!port) throw new Error('DeltaActionPort not configured — call configureDeltaActionPort first')
  return port
}

export function __resetDeltaActionPort(): void {
  port = undefined
}

export function applyDeltaAction(
  ...args: Parameters<DeltaActionPort['applyDeltaAction']>
): ReturnType<DeltaActionPort['applyDeltaAction']> {
  return requirePort().applyDeltaAction(...args)
}

export function applyDeltaActionGroupWithOutcomes(
  ...args: Parameters<DeltaActionPort['applyDeltaActionGroupWithOutcomes']>
): ReturnType<DeltaActionPort['applyDeltaActionGroupWithOutcomes']> {
  return requirePort().applyDeltaActionGroupWithOutcomes(...args)
}

export function readRowGuard(
  ...args: Parameters<DeltaActionPort['readRowGuard']>
): ReturnType<DeltaActionPort['readRowGuard']> {
  return requirePort().readRowGuard(...args)
}

export function userDeletedHappeningLink(
  ...args: Parameters<DeltaActionPort['userDeletedHappeningLink']>
): ReturnType<DeltaActionPort['userDeletedHappeningLink']> {
  return requirePort().userDeletedHappeningLink(...args)
}

export function reverseReplayDeltas(
  ...args: Parameters<DeltaActionPort['reverseReplayDeltas']>
): ReturnType<DeltaActionPort['reverseReplayDeltas']> {
  return requirePort().reverseReplayDeltas(...args)
}

export function reverseRunGroup(
  ...args: Parameters<DeltaActionPort['reverseRunGroup']>
): ReturnType<DeltaActionPort['reverseRunGroup']> {
  return requirePort().reverseRunGroup(...args)
}

export function settleUserWrites(): ReturnType<DeltaActionPort['settleUserWrites']> {
  return requirePort().settleUserWrites()
}

export function describeReplayError(
  e: unknown,
): ReturnType<DeltaActionPort['describeReplayError']> {
  return requirePort().describeReplayError(e)
}

export function holdBranchWriteExclusive(
  ...args: Parameters<DeltaActionPort['holdBranchWriteExclusive']>
): ReturnType<DeltaActionPort['holdBranchWriteExclusive']> {
  return requirePort().holdBranchWriteExclusive(...args)
}

export function releaseBranchWriteExclusive(
  ...args: Parameters<DeltaActionPort['releaseBranchWriteExclusive']>
): ReturnType<DeltaActionPort['releaseBranchWriteExclusive']> {
  return requirePort().releaseBranchWriteExclusive(...args)
}

export function reverseCloseForRerun(
  ...args: Parameters<DeltaActionPort['reverseCloseForRerun']>
): ReturnType<DeltaActionPort['reverseCloseForRerun']> {
  return requirePort().reverseCloseForRerun(...args)
}
