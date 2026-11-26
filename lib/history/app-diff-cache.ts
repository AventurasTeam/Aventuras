import { onLogRewritten } from '@/lib/actions'
import { db, type DbCtx } from '@/lib/db'

import { createDiffCache, type DiffCache } from './diff-cache'
import { walkTarget } from './diff-walk'

let source: DbCtx['db'] | null = null

/** The process-wide diff cache over the app database, evicted through the action layer's hook. */
export const diffCache: DiffCache = createDiffCache({
  walk: (requested) => walkTarget(source ?? db, requested),
})

// At module load, so no entry can exist before its eviction listener does.
onLogRewritten((branchId) => diffCache.evictBranch(branchId))

/** Test-only: the database the app cache walks; null restores the app's. */
export function __setDiffCacheDbForTest(testDb: DbCtx['db'] | null): void {
  source = testDb
}
