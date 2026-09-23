import type { Thread } from '@/lib/db'
import { threadActions, type ThreadDraft } from '@/lib/plot'

import type { DbCtx } from '../types'
import { commitPlotSave, type PlotSaveResult } from './commit-plot-save'

type SaveThreadArgs = { branchId: string; row: Thread | null; draft: ThreadDraft }

/** A create, or the changed columns of an update. */
export function saveThread(
  { branchId, row, draft }: SaveThreadArgs,
  ctx: DbCtx,
): Promise<PlotSaveResult> {
  return commitPlotSave(
    'thread',
    {
      branchId,
      rowId: row?.id ?? null,
      build: (id) => threadActions({ branchId, row, draft, id, now: Date.now() }),
    },
    ctx,
  )
}
