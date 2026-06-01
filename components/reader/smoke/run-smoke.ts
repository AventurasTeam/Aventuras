// TODO(spine): smoke scaffolding — removed when real story-creation + provider
// settings UI land (see docs/followups.md). Direct lib/db writes for the
// synthetic story/branch deliberately bypass the action layer (debug only).
import { eq } from 'drizzle-orm'

import { branches, stories } from '@/lib/db'
import { runPipeline, type RunCtx, type TxResult } from '@/lib/pipeline'
import { domain } from '@/lib/stores'
import { toast } from '@/lib/toast'

import {
  SMOKE_BRANCH_ID,
  SMOKE_KIND,
  SMOKE_STORY_ID,
  ensureSmokePipelineRegistered,
} from './smoke-pipeline'

type SmokeRunDeps = Pick<RunCtx, 'db' | 'runInTransaction'>

async function ensureSmokeStoryAndBranch(deps: SmokeRunDeps): Promise<void> {
  const [existing] = await deps.db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, SMOKE_BRANCH_ID))
  if (existing) return
  const now = Date.now()
  await deps.db
    .insert(stories)
    .values({ id: SMOKE_STORY_ID, title: 'Smoke test story', createdAt: now, updatedAt: now })
    .onConflictDoNothing()
  await deps.db
    .insert(branches)
    .values({ id: SMOKE_BRANCH_ID, storyId: SMOKE_STORY_ID, name: 'main', createdAt: now })
}

export async function runSmoke(deps: SmokeRunDeps): Promise<TxResult | null> {
  // Belt-and-suspenders: the trigger is __DEV__-gated at its call site, and the
  // stub provider already throws in production — this is the third gate.
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return null

  await ensureSmokeStoryAndBranch(deps)
  domain.setCurrentStory(SMOKE_STORY_ID)
  domain.setCurrentBranch(SMOKE_BRANCH_ID)
  ensureSmokePipelineRegistered()

  const result = await runPipeline(SMOKE_KIND, {
    storyId: SMOKE_STORY_ID,
    branchId: SMOKE_BRANCH_ID,
    db: deps.db,
    runInTransaction: deps.runInTransaction,
  })

  if (result.outcome === 'completed') toast.success('Smoke run completed')
  else toast.error(`Smoke run ${result.outcome}`)
  return result
}

export type { SmokeRunDeps }
