import {
  commitRowSave,
  flatRowSaveResult,
  ROW_SAVE_REJECTION,
  type FlatRowSaveRejectionCode,
  type FlatRowSaveResult,
} from '../row-save/commit-row-save'
import type { DbCtx, PipelineAction } from '../types'

export type PlotSaveResult = FlatRowSaveResult

export const PLOT_REJECTION = {
  inFlight: ROW_SAVE_REJECTION.inFlight,
  notFound: ROW_SAVE_REJECTION.notFound,
  failed: ROW_SAVE_REJECTION.failed,
} as const satisfies Record<string, FlatRowSaveRejectionCode>

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
  return commitRowSave(kind, { branchId, rowId, idPrefix: ID_PREFIX[kind], build }, ctx).then(
    flatRowSaveResult,
  )
}
