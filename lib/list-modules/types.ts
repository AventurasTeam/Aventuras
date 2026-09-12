import type { EntityKind } from '@/lib/db'

export const WORLD_CATEGORIES = ['character', 'location', 'item', 'faction', 'lore'] as const
export type WorldCategory = (typeof WORLD_CATEGORIES)[number]

export function isWorldCategory(value: unknown): value is WorldCategory {
  return typeof value === 'string' && (WORLD_CATEGORIES as readonly string[]).includes(value)
}

export function isEntityCategory(category: WorldCategory): category is EntityKind {
  return category !== 'lore'
}

export const ENTITY_FILTERS = ['all', 'in-scene', 'active', 'staged', 'retired'] as const
export type EntityFilter = (typeof ENTITY_FILTERS)[number]

export const ENTITY_TIERS = ['active', 'staged', 'retired'] as const
export type EntityTier = (typeof ENTITY_TIERS)[number]

export type ListQuery<Filter extends string> = { search: string; filter: Filter }

/** `leadId` comes from the story definition; `inScene` comes from lib/row-signals. */
export type EntityListSignals = { leadId: string | null; inScene: ReadonlySet<string> }

export type ListGroup<Row, Key extends string = string> = { key: Key; rows: Row[] }

export type ListGrouping<Row, Key extends string = string> = {
  pinned: Row | null
  groups: ListGroup<Row, Key>[]
}

export type ScopeField<Source, Key extends string> = {
  key: Key
  values: (source: Source) => (string | null | undefined)[]
}
