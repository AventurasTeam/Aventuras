import type { Lore } from '@/lib/db'
import { loreActions, type LoreDraft } from '@/lib/world'

import { commitRowSave, type RowSaveResult } from '../row-save/commit-row-save'
import type { DbCtx } from '../types'

export type LoreSaveResult = RowSaveResult

type SaveLoreArgs = { branchId: string; row: Lore | null; draft: LoreDraft }

/** One lore pane Save: a create, or the changed columns (world.md → Lore — separate kind). */
export function saveLore(
  { branchId, row, draft }: SaveLoreArgs,
  ctx: DbCtx,
): Promise<LoreSaveResult> {
  return commitRowSave(
    'lore',
    {
      branchId,
      rowId: row?.id ?? null,
      idPrefix: 'lore',
      build: (id) => loreActions({ branchId, row, draft, id, now: Date.now() }),
    },
    ctx,
  )
}
