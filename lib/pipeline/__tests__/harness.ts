import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { DeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { branches, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { clearBuffers, configureDiagnosticsGate } from '@/lib/diagnostics'
import {
  __resetBus,
  __resetRegistry,
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

export async function makeHarness(): Promise<{
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  ctx: RunCtx
}> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  return { db, ctx: { storyId: 's1', branchId: 'b1', db, runInTransaction } }
}

export function resetSingletons(): void {
  __resetRegistry()
  __resetBus()
  resetAllStores()
  clearBuffers()
  configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
  configureDeltaActionPort({
    applyDeltaAction,
    reverseReplayDeltas,
    describeReplayError: (e) => (e instanceof DeltaReplayError ? String(e.cause) : undefined),
  })
}
