import {
  VISUAL_CATEGORIES,
  type CharacterState,
  type Entity,
  type EntityKind,
  type FactionState,
  type ItemState,
  type LocationState,
} from '@/lib/db'
import { normalizeTerm } from '@/lib/keyword-terms'

import { collate, compareId } from './collate'
import { textIncludes } from './search-text'
import {
  ENTITY_TIERS,
  type EntityFilter,
  type EntityListSignals,
  type EntityTier,
  type ListGrouping,
  type ListQuery,
  type ScopeField,
} from './types'

/** Keys into `world:search.scope.*`; the surface translates them. */
export type EntitySearchScopeKey =
  | 'name'
  | 'description'
  | 'tags'
  | 'retiredReason'
  | 'traits'
  | 'drives'
  | 'voice'
  | 'visual'
  | 'condition'
  | 'standing'
  | 'agenda'

// patterns/entity.md → Search scope: row-level fields, every kind.
const IDENTITY_FIELDS: readonly ScopeField<Entity, EntitySearchScopeKey>[] = [
  { key: 'name', values: (e) => [e.name] },
  { key: 'description', values: (e) => [e.description] },
  { key: 'tags', values: (e) => e.tags },
  { key: 'retiredReason', values: (e) => [e.retiredReason] },
]

// patterns/entity.md → Search scope: state fields; excludes FK refs, stackables, lastSeenAt.
const CHARACTER_FIELDS: readonly ScopeField<CharacterState, EntitySearchScopeKey>[] = [
  { key: 'traits', values: (s) => s.traits },
  { key: 'drives', values: (s) => s.drives },
  { key: 'voice', values: (s) => [s.voice] },
  { key: 'visual', values: (s) => VISUAL_CATEGORIES.map((field) => s.visual[field]) },
]
const LOCATION_FIELDS: readonly ScopeField<LocationState, EntitySearchScopeKey>[] = [
  { key: 'condition', values: (s) => [s.condition] },
]
const ITEM_FIELDS: readonly ScopeField<ItemState, EntitySearchScopeKey>[] = [
  { key: 'condition', values: (s) => [s.condition] },
]
const FACTION_FIELDS: readonly ScopeField<FactionState, EntitySearchScopeKey>[] = [
  { key: 'standing', values: (s) => [s.standing] },
  { key: 'agenda', values: (s) => s.agenda ?? [] },
]

// Sound because lib/actions/entities/register.ts validates state per kind on write.
function stateSearchFields(entity: Entity): (string | null | undefined)[] {
  if (entity.state == null) return []
  switch (entity.kind) {
    case 'character':
      return CHARACTER_FIELDS.flatMap((f) => f.values(entity.state as CharacterState))
    case 'location':
      return LOCATION_FIELDS.flatMap((f) => f.values(entity.state as LocationState))
    case 'item':
      return ITEM_FIELDS.flatMap((f) => f.values(entity.state as ItemState))
    case 'faction':
      return FACTION_FIELDS.flatMap((f) => f.values(entity.state as FactionState))
  }
}

function entitySearchFields(entity: Entity): (string | null | undefined)[] {
  return [...IDENTITY_FIELDS.flatMap((f) => f.values(entity)), ...stateSearchFields(entity)]
}

export function matchesEntitySearch(entity: Entity, search: string): boolean {
  const needle = normalizeTerm(search)
  if (needle === '') return true
  return entitySearchFields(entity).some((field) => textIncludes(field, needle))
}

export function entityTier(entity: Entity): EntityTier {
  return entity.status
}

function matchesEntityFilter(
  entity: Entity,
  filter: EntityFilter,
  inScene: ReadonlySet<string>,
): boolean {
  if (filter === 'all') return true
  if (filter === 'in-scene') return inScene.has(entity.id)
  return entityTier(entity) === filter
}

const TIER_RANK: Record<EntityTier, number> = Object.fromEntries(
  ENTITY_TIERS.map((tier, index) => [tier, index]),
) as Record<EntityTier, number>

// patterns/entity.md → Entity list sort order.
export function compareEntities(a: Entity, b: Entity, signals: EntityListSignals): number {
  const aLead = a.id === signals.leadId
  const bLead = b.id === signals.leadId
  if (aLead !== bLead) return aLead ? -1 : 1
  const tierDiff = TIER_RANK[entityTier(a)] - TIER_RANK[entityTier(b)]
  if (tierDiff !== 0) return tierDiff
  if (entityTier(a) === 'active') {
    const aIn = signals.inScene.has(a.id)
    const bIn = signals.inScene.has(b.id)
    if (aIn !== bIn) return aIn ? -1 : 1
  }
  return collate(a.name, b.name) || a.createdAt - b.createdAt || compareId(a.id, b.id)
}

export function queryEntities(
  rows: readonly Entity[],
  kind: EntityKind,
  query: ListQuery<EntityFilter>,
  signals: EntityListSignals,
): Entity[] {
  return rows
    .filter(
      (e) =>
        e.kind === kind &&
        matchesEntityFilter(e, query.filter, signals.inScene) &&
        matchesEntitySearch(e, query.search),
    )
    .sort((a, b) => compareEntities(a, b, signals))
}

// patterns/entity.md → Entity list sort order: lead pin overrides tier, pinned not grouped.
export function groupEntitiesByTier(
  rows: readonly Entity[],
  leadId: string | null,
): ListGrouping<Entity, EntityTier> {
  const pinned = leadId == null ? null : (rows.find((r) => r.id === leadId) ?? null)
  const tierRows = pinned == null ? rows : rows.filter((r) => r.id !== pinned.id)
  const groups = ENTITY_TIERS.map((tier) => ({
    key: tier,
    rows: tierRows.filter((r) => entityTier(r) === tier),
  })).filter((group) => group.rows.length > 0)
  return { pinned, groups }
}

const STATE_SCOPE: Record<EntityKind, readonly EntitySearchScopeKey[]> = {
  character: CHARACTER_FIELDS.map((f) => f.key),
  location: LOCATION_FIELDS.map((f) => f.key),
  item: ITEM_FIELDS.map((f) => f.key),
  faction: FACTION_FIELDS.map((f) => f.key),
}

export function entitySearchScope(kind: EntityKind): readonly EntitySearchScopeKey[] {
  return [...IDENTITY_FIELDS.map((f) => f.key), ...STATE_SCOPE[kind]]
}
