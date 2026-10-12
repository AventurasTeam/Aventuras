import type { Entity } from '@/lib/db'
import { CAST_ID_PREFIX, entitiesStore } from '@/lib/stores'
import {
  entityActions,
  placeSaveRefusal,
  storyLocationIdOf,
  type EntitySaveInput,
} from '@/lib/world'

import { commitRowSave, ROW_SAVE_REJECTION, type RowSaveResult } from '../row-save/commit-row-save'
import { loadHeadTurn } from '../story-entries/head-turn'
import type { DbCtx } from '../types'

export type EntitySaveResult = RowSaveResult

export const ENTITY_REJECTION = ROW_SAVE_REJECTION

type SaveEntityArgs = EntitySaveInput & { branchId: string; row: Entity | null }

/**
 * One World pane Save: a create or the changed columns and state paths, plus relationships and a
 * retire's cascade; refused when it breaks a place rule (data-model.md → LocationState shape).
 */
export async function saveEntity(args: SaveEntityArgs, ctx: DbCtx): Promise<EntitySaveResult> {
  // Only a location update can hold the story. Read before the gate: nothing awaits after it.
  const head =
    args.kind === 'location' && args.row != null ? await loadHeadTurn(args.branchId, ctx) : null
  const storyLocationId = storyLocationIdOf(head)
  const branchEntities = [...entitiesStore.getEntities().values()].filter(
    (e) => e.branchId === args.branchId,
  )
  return commitRowSave(
    'entity',
    {
      branchId: args.branchId,
      rowId: args.row?.id ?? null,
      idPrefix: CAST_ID_PREFIX[args.kind],
      refuse: () => placeSaveRefusal({ ...args, branchEntities, storyLocationId }),
      build: (id) => entityActions({ ...args, id, now: Date.now(), branchEntities }),
    },
    ctx,
  )
}
