import { and, asc, eq, isNull } from 'drizzle-orm'

import { pipelineRuns } from '@/lib/db'

import type { DbCtx } from '../types'

export type UnfinishedRun = {
  readonly runId: string
  readonly kind: string
  readonly actionId: string
  readonly rerunChapterId: string | null
}

/**
 * C2: a branch's unfinished runs, oldest start first. A run that records no branch is in no
 * branch's read.
 */
export async function readUnfinishedRuns(
  branchId: string,
  ctx: Pick<DbCtx, 'db'>,
): Promise<UnfinishedRun[]> {
  return ctx.db
    .select({
      runId: pipelineRuns.runId,
      kind: pipelineRuns.kind,
      actionId: pipelineRuns.actionId,
      rerunChapterId: pipelineRuns.rerunChapterId,
    })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.branchId, branchId), isNull(pipelineRuns.finishedAt)))
    .orderBy(asc(pipelineRuns.startedAt), asc(pipelineRuns.runId))
}
