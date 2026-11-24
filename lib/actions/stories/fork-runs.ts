import { and, eq, inArray } from 'drizzle-orm'

import { chapters, chunked, deltas, reversalJournals } from '@/lib/db'

import type { ReversePlan } from '../delta/reverse-replay'
import { readUnfinishedRuns, type UnfinishedRun } from '../delta/unfinished-runs'
import type { DbCtx } from '../types'

export type CarriedRun = {
  readonly runId: string
  readonly actionId: string
  readonly carries: 'delta' | 'journal' | 'chapter'
}

/** What the parent holds under each unfinished run. */
type RunWrites = {
  readonly deltas: readonly { readonly id: string; readonly actionId: string }[]
  /** Action ids with a reversal_journals row. */
  readonly journals: ReadonlySet<string>
  /** Re-run chapter ids the parent still holds. */
  readonly chapters: ReadonlySet<string>
}

/** What the plan takes off the child. */
type ForkLeaves = {
  /** Pruned, or re-owned to the write that kept the row. */
  readonly deltas: ReadonlySet<string>
  readonly journals: ReadonlySet<string>
  /** Chapters whose create the plan prunes. */
  readonly chapters: ReadonlySet<string>
}

/** C2: the first unfinished run on `parentBranchId` whose writes the fork would carry. */
export async function unfinishedRunCarried(
  parentBranchId: string,
  plan: ReversePlan | null,
  ctx: Pick<DbCtx, 'db'>,
): Promise<CarriedRun | null> {
  const runs = await readUnfinishedRuns(parentBranchId, ctx)
  if (runs.length === 0) return null
  const actionIds = runs.map((run) => run.actionId)
  const writes: RunWrites = {
    deltas: await runDeltas(parentBranchId, actionIds, ctx),
    journals: await journaledActions(parentBranchId, actionIds, ctx),
    chapters: await chaptersHeld(
      parentBranchId,
      runs.flatMap((run) => (run.rerunChapterId === null ? [] : [run.rerunChapterId])),
      ctx,
    ),
  }
  const leaves = leavesOf(plan)
  for (const run of runs) {
    const carries = carriedBy(run, writes, leaves)
    if (carries !== null) return { runId: run.runId, actionId: run.actionId, carries }
  }
  return null
}

// No plan (the fork entry is the narrative tail): nothing leaves, so every write copies.
function leavesOf(plan: ReversePlan | null): ForkLeaves {
  const pruned = plan?.prunedDeltas ?? []
  return {
    deltas: new Set([...pruned, ...(plan?.reownedDeltas ?? [])].map((d) => d.id)),
    journals: new Set((plan?.droppedJournals ?? []).map((journal) => journal.actionId)),
    chapters: new Set(
      pruned
        .filter((d) => d.targetTable === 'chapters' && d.op === 'create')
        .map((d) => d.targetId),
    ),
  }
}

// A re-owned create changes hands on the child, as recovery would leave it on the parent. A
// committed re-run's chapter, kept, stands half undone with nothing left to restore it.
function carriedBy(
  run: UnfinishedRun,
  writes: RunWrites,
  leaves: ForkLeaves,
): CarriedRun['carries'] | null {
  if (writes.deltas.some((d) => d.actionId === run.actionId && !leaves.deltas.has(d.id)))
    return 'delta'
  if (writes.journals.has(run.actionId) && !leaves.journals.has(run.actionId)) return 'journal'
  const chapterId = run.rerunChapterId
  if (chapterId !== null && writes.chapters.has(chapterId) && !leaves.chapters.has(chapterId))
    return 'chapter'
  return null
}

async function runDeltas(
  branchId: string,
  actionIds: readonly string[],
  ctx: Pick<DbCtx, 'db'>,
): Promise<RunWrites['deltas']> {
  const rows: { id: string; actionId: string }[] = []
  for (const chunk of chunked(actionIds))
    rows.push(
      ...(await ctx.db
        .select({ id: deltas.id, actionId: deltas.actionId })
        .from(deltas)
        .where(and(eq(deltas.branchId, branchId), inArray(deltas.actionId, chunk)))),
    )
  return rows
}

async function journaledActions(
  branchId: string,
  actionIds: readonly string[],
  ctx: Pick<DbCtx, 'db'>,
): Promise<ReadonlySet<string>> {
  const found = new Set<string>()
  for (const chunk of chunked(actionIds)) {
    const rows = await ctx.db
      .select({ actionId: reversalJournals.actionId })
      .from(reversalJournals)
      .where(
        and(eq(reversalJournals.branchId, branchId), inArray(reversalJournals.actionId, chunk)),
      )
    for (const row of rows) found.add(row.actionId)
  }
  return found
}

async function chaptersHeld(
  branchId: string,
  chapterIds: readonly string[],
  ctx: Pick<DbCtx, 'db'>,
): Promise<ReadonlySet<string>> {
  const found = new Set<string>()
  for (const chunk of chunked(chapterIds)) {
    const rows = await ctx.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.branchId, branchId), inArray(chapters.id, chunk)))
    for (const row of rows) found.add(row.id)
  }
  return found
}
