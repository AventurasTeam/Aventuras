import { branches, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { clearBuffers, clearCurrentActionId, configureDiagnosticsGate } from '@/lib/diagnostics'
import { __resetBus, __resetRegistry, type RunCtx } from '@/lib/pipeline'
import { domain } from '@/lib/stores'

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
  domain.__reset()
  clearCurrentActionId()
  clearBuffers()
  configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
}
