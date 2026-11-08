import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
  settleUserWrites,
} from '@/lib/actions/delta/apply-delta-action'
import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/actions/delta/branch-write-lock'
import { describeDeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { readRowGuard } from '@/lib/actions/delta/row-guard'
import { __resetBranchQueues } from '@/lib/actions/turns/branch-queue'
import { branches, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { clearBuffers, configureDiagnosticsGate } from '@/lib/diagnostics'
import {
  __resetBus,
  __resetRegistry,
  type DeltaActionPort,
  type RejectedStart,
  type RunCtx,
  type TxResult,
} from '@/lib/pipeline'
import { configureDeltaActionPort } from '@/lib/pipeline/runtime/action-port'
import { resetAllStores } from '@/lib/stores'

// Narrows runPipeline's union for the single-run tests that never hit a blocked start.
export function expectRan(result: TxResult | RejectedStart): TxResult {
  if (result.outcome === 'rejected')
    throw new Error(`unexpected rejected start: ${result.blockedBy}`)
  return result
}

// Fails in 2 s instead of at the test timeout: a run that never reaches its hold leaves `work`
// pending, and with it the caller (and any branch queue it holds).
export function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within 2 s`)), 2_000)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

export async function makeHarness(): Promise<{
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  ctx: RunCtx
}> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  return { db, ctx: { storyId: 's1', branchId: 'b1', db, runInTransaction } }
}

/** The port boot wires, from the action layer's own functions; a test spreads its override over it. */
export function realDeltaActionPort(): DeltaActionPort {
  return {
    applyDeltaAction,
    applyDeltaActionGroupWithOutcomes,
    readRowGuard,
    reverseReplayDeltas,
    describeReplayError: describeDeltaReplayError,
    settleUserWrites,
    holdBranchWriteExclusive,
    releaseBranchWriteExclusive,
  }
}

export function resetSingletons(): void {
  __resetRegistry()
  __resetBus()
  __resetBranchQueues()
  __resetBranchWriteLocks()
  resetAllStores()
  clearBuffers()
  configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
  configureDeltaActionPort(realDeltaActionPort())
}
