import type { IntegrityRefusal, MutationResult, PipelineAction } from '@/lib/actions/types'
import type { DbCtx, SqlOp } from '@/lib/db'

export type DeltaActionPort = {
  applyDeltaAction: (
    args: { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null },
    ctx: DbCtx,
  ) => Promise<MutationResult>
  reverseReplayDeltas: (
    actionId: string,
    ctx: DbCtx,
    settleOps?: (deltaCount: number) => readonly SqlOp[],
  ) => Promise<number>
  // Undefined for anything but a DeltaReplayError. `committed` means the reversal
  // landed and only the store sync after it failed; `refusal` names an integrity refusal.
  describeReplayError: (
    e: unknown,
  ) => { detail: string; committed: boolean; refusal: IntegrityRefusal | null } | undefined
  /** Resolves once every user write dispatched so far has committed or been refused. */
  settleUserWrites: () => Promise<void>
  /** Takes the branch write lock exclusive for the run; idempotent per actionId, never rejects. */
  holdWritePhase: (branchId: string, actionId: string) => Promise<void>
  /** Ends the run's hold (or queued request); does nothing when it has none. */
  releaseWritePhase: (branchId: string, actionId: string) => void
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

export function reverseReplayDeltas(
  ...args: Parameters<DeltaActionPort['reverseReplayDeltas']>
): ReturnType<DeltaActionPort['reverseReplayDeltas']> {
  return requirePort().reverseReplayDeltas(...args)
}

export function settleUserWrites(): ReturnType<DeltaActionPort['settleUserWrites']> {
  return requirePort().settleUserWrites()
}

export function describeReplayError(
  e: unknown,
): ReturnType<DeltaActionPort['describeReplayError']> {
  return requirePort().describeReplayError(e)
}

export function holdWritePhase(
  ...args: Parameters<DeltaActionPort['holdWritePhase']>
): ReturnType<DeltaActionPort['holdWritePhase']> {
  return requirePort().holdWritePhase(...args)
}

export function releaseWritePhase(
  ...args: Parameters<DeltaActionPort['releaseWritePhase']>
): ReturnType<DeltaActionPort['releaseWritePhase']> {
  return requirePort().releaseWritePhase(...args)
}
