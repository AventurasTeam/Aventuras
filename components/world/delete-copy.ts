import type { DeleteConfirmCopy } from '@/components/compounds/delete-confirm-dialog'
import { ENTITY_DELETE_CODES } from '@/lib/actions'
import type { Entity, Lore } from '@/lib/db'
import { t } from '@/lib/i18n'

export type EntityDeleteImpact = {
  awareness: number
  involvements: number
  relationships: number
  references: number
  unplacedItems: number
  tailScene: boolean
}

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
    description: t('world:delete.description'),
    impacts,
    confirmLabel: t(`world:delete.confirm.${row.kind}`),
  }
}

export function loreDeleteCopy(row: Lore): DeleteConfirmCopy {
  return {
    title: t('world:delete.loreTitle', { name: row.title }),
    description: t('world:delete.description'),
    impacts: [],
    confirmLabel: t('world:delete.confirm.lore'),
  }
}

/** A refused delete's user-facing text; the actions' own reasons are developer strings. */
export function deleteRejectionText(code: string | undefined): string {
  if (code === ENTITY_DELETE_CODES.inFlight) return t('world:delete.inFlight')
  if (code === ENTITY_DELETE_CODES.leadEntity) return t('world:delete.leadReason')
  return t('world:delete.failed')
}
