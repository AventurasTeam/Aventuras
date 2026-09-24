import { commitRowSave, ROW_SAVE_REJECTION, type RowSaveResult } from '../row-save/commit-row-save'
import type { DbCtx, PipelineAction } from '../types'

export type PlotSaveResult = RowSaveResult

export const PLOT_REJECTION = ROW_SAVE_REJECTION

type CommitPlotSaveArgs = {
  branchId: string
  /** Null for a create; the id is generated before the actions are built. */
  rowId: string | null
  build: (id: string) => PipelineAction[]
}

const ID_PREFIX = { thread: 'thr', happening: 'hap' } as const

export function commitPlotSave(
  kind: 'thread' | 'happening',
  { branchId, rowId, build }: CommitPlotSaveArgs,
  ctx: DbCtx,
): Promise<PlotSaveResult> {
  return commitRowSave(kind, { branchId, rowId, idPrefix: ID_PREFIX[kind], build }, ctx)
}
