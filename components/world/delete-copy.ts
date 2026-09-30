import { deleteUndoHint, type DeleteConfirmCopy } from '@/components/compounds/delete-confirm-copy'
import { gateDisabledReason } from '@/components/compounds/generation-gate-copy'
import { ROW_DELETE_REJECTION, type RowDeleteRejectionCode } from '@/lib/actions'
import type { Entity, Lore } from '@/lib/db'
import { t } from '@/lib/i18n'

import type { EntityDeleteImpact } from './delete-impact'

/** world.md → Delete: what goes with an entity, before the user confirms. */
export function entityDeleteCopy(row: Entity, impact: EntityDeleteImpact): DeleteConfirmCopy {
  const impacts: string[] = []
  if (impact.awareness > 0) impacts.push(t('world:delete.awareness', { count: impact.awareness }))
  if (impact.involvements > 0)
    impacts.push(t('world:delete.involvements', { count: impact.involvements }))
  if (impact.relationships > 0)
    impacts.push(t('world:delete.relationships', { count: impact.relationships }))
  if (impact.references > 0)
    impacts.push(t('world:delete.references', { count: impact.references }))
  if (impact.unplacedItems > 0)
    impacts.push(t('world:delete.unplacedItems', { count: impact.unplacedItems }))
  if (impact.tailScene) impacts.push(t('world:delete.tailScene'))
  return {
    title: t('world:delete.entityTitle', { name: row.name }),
    description: deleteUndoHint(),
    impacts,
    confirmLabel: t(`world:delete.confirm.${row.kind}`),
  }
}

export function loreDeleteCopy(row: Lore): DeleteConfirmCopy {
  return {
    title: t('world:delete.loreTitle', { name: row.title }),
    description: deleteUndoHint(),
    impacts: [],
    confirmLabel: t('world:delete.confirm.lore'),
  }
}

// Exhaustive: a new RowDeleteRejectionCode fails typecheck until it has text here.
const DELETE_REJECTION_TEXT: Record<RowDeleteRejectionCode, () => string> = {
  [ROW_DELETE_REJECTION.inFlight]: () => t('world:delete.inFlight'),
  [ROW_DELETE_REJECTION.leadEntity]: () => t('world:delete.leadReason'),
  [ROW_DELETE_REJECTION.notFound]: () => t('world:delete.failed'),
  [ROW_DELETE_REJECTION.failed]: () => t('world:delete.failed'),
}

/** A refused delete's user-facing text; the actions' own reasons are developer strings. */
export function deleteRejectionText(code: RowDeleteRejectionCode): string {
  return DELETE_REJECTION_TEXT[code]()
}

/** Why `Delete entity` is unavailable for this row, or undefined when it is available. */
export function deleteDisabledReason(
  row: Entity,
  leadId: string | null,
  blocked: boolean,
  blockedReason?: string,
): string | undefined {
  const gateReason = gateDisabledReason(blocked, blockedReason)
  if (gateReason != null) return gateReason
  if (row.id === leadId) return t('world:delete.leadReason')
  return undefined
}
