import { and, asc, eq, gt, ne } from 'drizzle-orm'

import { idleStatus } from '@/lib/classifier'
import {
  branchCopyOps,
  branches,
  stories,
  storyEntries,
  type ClassifierStatus,
  type SqlOp,
} from '@/lib/db'
import { isStorySwapPending } from '@/lib/embedder-swap'
import { generateId } from '@/lib/ids'
import { generationStore, isUserEditBlocked } from '@/lib/stores'

import { holdBranchWriteExclusive, releaseBranchWriteExclusive } from '../delta/branch-write-lock'
import { logReversalRefused } from '../delta/commit-new-action'
import {
  buildReverseAndPrunePlan,
  ReversalIntegrityError,
  type ReversePlan,
} from '../delta/reverse-replay'
import {
  resolveSweep,
  type ResolvedSweep,
  type StoryEntryRejection,
} from '../story-entries/operational'
import { STORY_ENTRY_REJECTION } from '../story-entries/register'
import type { DbCtx } from '../types'
import { forkSurvivorPredicates } from './fork-survivors'

export const FORK_REFUSAL = {
  gated: 'gated',
  swapPending: 'swap-pending',
  entryMissing: 'entry-missing',
  entrySystem: 'entry-system',
  unfinishedRun: 'unfinished-run',
  rollbackFloor: 'rollback-floor',
  integrity: 'integrity',
} as const
export type ForkRefusalCode = (typeof FORK_REFUSAL)[keyof typeof FORK_REFUSAL]
export type ForkRefusal = { status: 'rejected'; code: ForkRefusalCode; reason: string }
export type ForkResult = { status: 'ok'; branchId: string } | ForkRefusal

export type ForkBranchInput = {
  readonly parentBranchId: string
  readonly forkEntryId: string
  /** Stored as given; the creation modal trims (C8). */
  readonly name: string
  readonly makeCurrent: boolean
}
export type ForkBranchCoreInput = ForkBranchInput & {
  readonly newBranchId: string
  readonly createdAt: number
}

/** The plan on the parent; null when the fork entry is the narrative tail. */
export type ForkPlan = { swept: ResolvedSweep; plan: ReversePlan } | null

const refused = (code: ForkRefusalCode, reason: string): ForkRefusal => ({
  status: 'rejected',
  code,
  reason,
})

const swapRefusal = (storyId: string): ForkRefusal =>
  refused(FORK_REFUSAL.swapPending, `an embedder swap is pending on ${storyId}`)

/** data-model.md → Branch model's fork, under a fresh `br_` id and the current time. */
export function forkBranch(input: ForkBranchInput, ctx: DbCtx): Promise<ForkResult> {
  return forkBranchCore({ ...input, newBranchId: generateId('br'), createdAt: Date.now() }, ctx)
}

/** The fork with its id and time given, for the seed (C7); refuses and locks as forkBranch does. */
export async function forkBranchCore(input: ForkBranchCoreInput, ctx: DbCtx): Promise<ForkResult> {
  // No branch: the parent's own hold doesn't refuse; what its open run would carry decides.
  if (isUserEditBlocked(generationStore.getTxState()))
    return refused(FORK_REFUSAL.gated, 'generation in flight')
  // Holds are idempotent per id: under a shared id one fork's release would free another's.
  const holdId = `fork:${input.newBranchId}`
  await holdBranchWriteExclusive(input.parentBranchId, holdId)
  try {
    return await forkHeld(input, ctx)
  } finally {
    releaseBranchWriteExclusive(input.parentBranchId, holdId)
  }
}

async function forkHeld(input: ForkBranchCoreInput, ctx: DbCtx): Promise<ForkResult> {
  const { parentBranchId, forkEntryId, newBranchId } = input
  const [parent] = await ctx.db.select().from(branches).where(eq(branches.id, parentBranchId))
  if (!parent) return refused(FORK_REFUSAL.entryMissing, `no branch ${parentBranchId}`)
  const [forkEntry] = await ctx.db
    .select({ kind: storyEntries.kind, position: storyEntries.position })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, parentBranchId), eq(storyEntries.id, forkEntryId)))
  if (!forkEntry)
    return refused(
      FORK_REFUSAL.entryMissing,
      `story_entries ${parentBranchId}:${forkEntryId} not found`,
    )
  if (forkEntry.kind === 'system')
    return refused(FORK_REFUSAL.entrySystem, `${forkEntryId} is a system entry`)
  if (isStorySwapPending(parent.storyId)) return swapRefusal(parent.storyId)

  const planned = await planFork(parentBranchId, forkEntry.position, newBranchId, ctx)
  if (planned.status === 'rejected') return planned

  const copyOps = await branchCopyOps(ctx.db, {
    from: parentBranchId,
    to: newBranchId,
    mode: 'fork',
    where: forkSurvivorPredicates(planned.fork),
    between: planned.fork ? [...planned.fork.plan.writeOps, ...planned.fork.plan.reownOps] : [],
  })
  const ops: SqlOp[] = [
    ctx.db
      .insert(branches)
      .values({
        id: newBranchId,
        storyId: parent.storyId,
        parentBranchId,
        forkEntryId,
        name: input.name,
        createdAt: input.createdAt,
        classifierStatus: forkStatus(parent.classifierStatus, forkEntry.position),
      })
      .toSQL(),
    ...(input.makeCurrent
      ? [
          ctx.db
            .update(stories)
            .set({ currentBranchId: newBranchId })
            .where(eq(stories.id, parent.storyId))
            .toSQL(),
        ]
      : []),
    ...copyOps,
  ]
  // A swap admitted since the first check is in flight by now; one admitted after this
  // synchronous step lists the story's branches behind the batch, the child among them.
  if (isStorySwapPending(parent.storyId)) return swapRefusal(parent.storyId)
  await ctx.runInTransaction(ops)
  return { status: 'ok', branchId: newBranchId }
}

/** B and the plan a fork at `forkPosition` runs. */
export async function planFork(
  parentBranchId: string,
  forkPosition: number,
  newBranchId: string,
  ctx: DbCtx,
): Promise<{ status: 'planned'; fork: ForkPlan } | ForkRefusal> {
  const [next] = await ctx.db
    .select({ id: storyEntries.id })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, parentBranchId),
        gt(storyEntries.position, forkPosition),
        ne(storyEntries.kind, 'system'),
      ),
    )
    .orderBy(asc(storyEntries.position))
    .limit(1)
  if (!next) return { status: 'planned', fork: null }
  const swept = await resolveSweep(parentBranchId, next.id, ctx)
  if ('status' in swept) return sweepRefusal(swept)
  try {
    const plan = await buildReverseAndPrunePlan(
      swept.set,
      ctx,
      { keepRedoExact: false },
      { writeBranchId: newBranchId },
    )
    return { status: 'planned', fork: { swept, plan } }
  } catch (e) {
    if (!(e instanceof ReversalIntegrityError)) throw e
    logReversalRefused(parentBranchId, e)
    return refused(FORK_REFUSAL.integrity, e.message)
  }
}

function sweepRefusal(rejection: StoryEntryRejection): ForkRefusal {
  if (rejection.code === STORY_ENTRY_REJECTION.rollbackFloor)
    return refused(FORK_REFUSAL.rollbackFloor, rejection.reason)
  // resolveSweep logged the closure's refusal already.
  if (rejection.code === STORY_ENTRY_REJECTION.deltaFailed)
    return refused(FORK_REFUSAL.integrity, rejection.reason)
  throw new Error(`forkBranch: the sweep refused as ${rejection.code}: ${rejection.reason}`)
}

function forkStatus(parent: ClassifierStatus | null, forkPosition: number): ClassifierStatus {
  const processed = parent?.processedThrough ?? null
  // A null watermark processed nothing; Math.min would read it as 0.
  return {
    ...idleStatus(),
    processedThrough: processed === null ? null : Math.min(processed, forkPosition),
  }
}
