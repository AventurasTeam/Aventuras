import { useCallback, useState } from 'react'

import type { DeleteConfirmCopy } from '@/components/compounds/delete-confirm-copy'
import { deleteEntityRow, deleteRow, type DbCtx, type RowDeleteResult } from '@/lib/actions'
import type { Entity, Lore } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import {
  characterRelationshipsStore,
  entitiesStore,
  entriesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  loreStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

import { deleteRejectionText, entityDeleteCopy, loreDeleteCopy } from './delete-copy'
import { entityDeleteImpact } from './delete-impact'

export type WorldDeleteTarget = { kind: 'entity'; row: Entity } | { kind: 'lore'; row: Lore }

/**
 * Re-reads the target by id at proceed time (after a dirty-pane Save/Discard/Cancel resolves) —
 * a Save can rename the row or a concurrent write can remove it before the confirm opens.
 */
export function freshDeleteTarget(
  target: WorldDeleteTarget,
  entities: ReadonlyMap<string, Entity>,
  lore: ReadonlyMap<string, Lore>,
): WorldDeleteTarget | null {
  if (target.kind === 'lore') {
    const row = lore.get(target.row.id)
    return row == null ? null : { kind: 'lore', row }
  }
  const row = entities.get(target.row.id)
  return row == null ? null : { kind: 'entity', row }
}

function confirmCopy(branchId: string, target: WorldDeleteTarget): DeleteConfirmCopy {
  if (target.kind === 'lore') return loreDeleteCopy(target.row)
  const impact = entityDeleteImpact({
    branchId,
    row: target.row,
    entities: [...entitiesStore.getEntities().values()].filter((e) => e.branchId === branchId),
    entries: entriesStore.getEntries().values(),
    awareness: happeningAwarenessStore.getAwareness().values(),
    involvements: happeningInvolvementsStore.getInvolvements().values(),
    relationships: characterRelationshipsStore.getRelationshipRows().values(),
  })
  return entityDeleteCopy(target.row, impact)
}

/**
 * world.md → Delete: the confirm, then one grouped delete. The row leaving the store clears the
 * selection (`useWorldSelection`); CTRL-Z in the reader brings it back.
 */
export function useWorldDelete(branchId: string, ctx: DbCtx, guard: (proceed: () => void) => void) {
  const [pending, setPending] = useState<{
    target: WorldDeleteTarget
    copy: DeleteConfirmCopy
  } | null>(null)

  const request = useCallback(
    (target: WorldDeleteTarget) =>
      guard(() => {
        const fresh = freshDeleteTarget(target, entitiesStore.getEntities(), loreStore.getLore())
        if (fresh == null) return
        setPending({ target: fresh, copy: confirmCopy(branchId, fresh) })
      }),
    [branchId, guard],
  )
  const cancel = useCallback(() => setPending(null), [])
  const confirm = useCallback(() => {
    if (pending == null) return
    const { target } = pending
    setPending(null)
    const name = target.kind === 'entity' ? target.row.name : target.row.title
    const write: Promise<RowDeleteResult> =
      target.kind === 'entity'
        ? deleteEntityRow(branchId, target.row.id, ctx)
        : deleteRow('lore', branchId, target.row.id, ctx)
    write.then(
      (result) => {
        if (result.status === 'ok') toast.success(t('world:delete.done', { name }))
        else toast.error(deleteRejectionText(result.code))
      },
      (error: unknown) => {
        logger.error('app.world_delete_failed', {
          branchId,
          id: target.row.id,
          error: error instanceof Error ? error.message : String(error),
        })
        toast.error(t('world:delete.failed'))
      },
    )
  }, [pending, branchId, ctx])

  return { copy: pending?.copy ?? null, request, cancel, confirm }
}
