import type { Entity } from '@/lib/db'
import { CAST_ID_PREFIX } from '@/lib/stores'
import { entityActions, PARENT_CYCLE, type EntitySaveInput } from '@/lib/world'

import { commitRowSave, ROW_SAVE_REJECTION, type RowSaveResult } from '../row-save/commit-row-save'
import type { DbCtx } from '../types'

export type EntitySaveResult = RowSaveResult

export const ENTITY_REJECTION = { ...ROW_SAVE_REJECTION, parentCycle: PARENT_CYCLE } as const

type SaveEntityArgs = EntitySaveInput & { branchId: string; row: Entity | null }

/** One World pane Save: a create or the row's changed columns and state paths, plus relationships. */
export function saveEntity(args: SaveEntityArgs, ctx: DbCtx): Promise<EntitySaveResult> {
  return commitRowSave(
    'entity',
    {
      branchId: args.branchId,
      rowId: args.row?.id ?? null,
      idPrefix: CAST_ID_PREFIX[args.kind],
      build: (id) => entityActions({ ...args, id, now: Date.now() }),
    },
    ctx,
  )
}
