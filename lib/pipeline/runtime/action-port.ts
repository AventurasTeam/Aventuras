import type { MutationResult, PipelineAction } from '@/lib/actions/types'
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
  // landed and only the store sync after it failed.
  describeReplayError: (e: unknown) => { detail: string; committed: boolean } | undefined
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

export function describeReplayError(
  e: unknown,
): ReturnType<DeltaActionPort['describeReplayError']> {
  return requirePort().describeReplayError(e)
}
