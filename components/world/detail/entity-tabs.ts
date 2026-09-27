import type { EntityKind } from '@/lib/db'

/** world.md → Tabs — per-kind composition. */
export const ENTITY_TABS = [
  'overview',
  'identity',
  'carrying',
  'connections',
  'settings',
  'assets',
  'involvements',
  'history',
] as const

export type EntityTab = (typeof ENTITY_TABS)[number]

const WITHOUT_CARRYING = ENTITY_TABS.filter((tab) => tab !== 'carrying')

export function entityTabs(kind: EntityKind): readonly EntityTab[] {
  return kind === 'character' ? ENTITY_TABS : WITHOUT_CARRYING
}

/** A deep link's `tab`, when the kind has it. */
export function entityTabOf(kind: EntityKind, raw: string | undefined): EntityTab | undefined {
  return entityTabs(kind).find((tab) => tab === raw)
}
