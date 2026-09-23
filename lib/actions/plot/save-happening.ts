import type { Happening } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { happeningActions, type HappeningDraft, type HappeningLinks } from '@/lib/plot'

import type { DbCtx } from '../types'
import { commitPlotSave, type PlotSaveResult } from './commit-plot-save'

type SaveHappeningArgs = {
  branchId: string
  row: Happening | null
  links: HappeningLinks
  draft: HappeningDraft
}

/** Row plus involvement and awareness changes as one `action_id`; undo reverses the whole Save. */
export function saveHappening(
  { branchId, row, links, draft }: SaveHappeningArgs,
  ctx: DbCtx,
): Promise<PlotSaveResult> {
  return commitPlotSave(
    'happening',
    {
      branchId,
      rowId: row?.id ?? null,
      build: (id) =>
        happeningActions({
          branchId,
          row,
          links,
          draft,
          id,
          now: Date.now(),
          newId: generateId,
        }),
    },
    ctx,
  )
}
