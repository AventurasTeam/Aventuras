import { eq, sql } from 'drizzle-orm'

import { branches, stories } from '@/lib/db'
import { readStorySwapPending } from '@/lib/embedder-swap'
import { generationStore, type TxState } from '@/lib/stores'

import { readUnfinishedRuns } from '../delta/unfinished-runs'
import type { DbCtx } from '../types'

export const DUPLICATE_REFUSAL = {
  missing: 'missing',
  empty: 'empty',
  draft: 'draft',
  swapPending: 'swap-pending',
  runRegistered: 'run-registered',
  branchHeld: 'branch-held',
  unfinishedRun: 'unfinished-run',
} as const
export type DuplicateRefusalCode = (typeof DUPLICATE_REFUSAL)[keyof typeof DUPLICATE_REFUSAL]
/** One branch, or the whole tree. */
export type DuplicateBranch = 'all' | { readonly branchId: string }
export type DuplicateCheck =
  | { status: 'ok' }
  | { status: 'rejected'; code: Exclude<DuplicateRefusalCode, 'empty'> }

type CheckRefusal = Extract<DuplicateCheck, { status: 'rejected' }>

const refused = (code: CheckRefusal['code']): CheckRefusal => ({ status: 'rejected', code })

// RunState.storyId is nullable, so a run also counts by its branch.
function runOnStory(txState: TxState, storyId: string, branchIds: readonly string[]): boolean {
  return [...txState.runs.values()].some(
    (run) => run.storyId === storyId || branchIds.includes(run.branchId),
  )
}

/**
 * data-model.md → Story duplicate, Refused before any write: the first refusal for copying
 * `branch`, or ok. `missing`: no such story, or no branch of it to copy.
 */
export async function checkStoryDuplicate(
  storyId: string,
  branch: DuplicateBranch,
  ctx: Pick<DbCtx, 'db'>,
): Promise<DuplicateCheck> {
  const [story] = await ctx.db
    .select({ status: stories.status })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (story == null) return refused(DUPLICATE_REFUSAL.missing)
  const onStory = await ctx.db
    .select({
      id: branches.id,
      state: sql<string | null>`json_extract(${branches.classifierStatus}, '$.state')`,
    })
    .from(branches)
    .where(eq(branches.storyId, storyId))
  const copied = branch === 'all' ? onStory : onStory.filter(({ id }) => id === branch.branchId)
  if (copied.length === 0) return refused(DUPLICATE_REFUSAL.missing)
  if (story.status === 'draft') return refused(DUPLICATE_REFUSAL.draft)
  // isStorySwapPending sees a stored marker on the open story alone; the list asks about any.
  if (await readStorySwapPending(ctx.db, storyId)) return refused(DUPLICATE_REFUSAL.swapPending)
  const branchIds = onStory.map(({ id }) => id)
  if (runOnStory(generationStore.getTxState(), storyId, branchIds))
    return refused(DUPLICATE_REFUSAL.runRegistered)
  // The copy takes classifier_status verbatim, so it would inherit the hold.
  if (copied.some(({ state }) => state === 'running')) return refused(DUPLICATE_REFUSAL.branchHeld)
  // pipeline_runs never copies: an unfinished run's writes would land with no marker to recover.
  for (const { id } of copied)
    if ((await readUnfinishedRuns(id, ctx)).length > 0)
      return refused(DUPLICATE_REFUSAL.unfinishedRun)
  return { status: 'ok' }
}
