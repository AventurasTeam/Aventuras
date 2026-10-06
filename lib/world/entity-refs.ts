import type {
  CharacterRelationship,
  CharacterState,
  Entity,
  EntityState,
  HappeningAwareness,
  HappeningInvolvement,
} from '@/lib/db'

import { heldItems, stateOf } from './entity-draft'

type Held = Pick<CharacterState, 'equipped_items' | 'inventory'>

/**
 * Equipped then inventory with `fromId` replaced by `toId`, or dropped when `toId` is null. `toId`
 * keeps only its first place, since a holder holds an item once. Null when neither names `fromId`.
 */
function heldRewritten(state: Held, fromId: string, toId: string | null): Held | null {
  if (!heldItems(state).includes(fromId)) return null
  let placed = false
  const rewrite = (ids: readonly string[]): string[] =>
    ids.flatMap((id) => {
      const next = id === fromId ? toId : id
      if (next == null) return []
      if (next === toId) {
        if (placed) return []
        placed = true
      }
      return [next]
    })
  const equipped = rewrite(state.equipped_items ?? [])
  const inventory = rewrite(state.inventory ?? [])
  return { equipped_items: equipped, inventory }
}

/**
 * Every ref field of `entity` naming `fromId` pointed at `toId`, or cleared when `toId` is null.
 * A ref on `toId` itself is cleared: a location can't parent itself. Null when nothing changed.
 * Keeps `toId` once within this entity; the caller ensures `toId` holds no other position.
 */
export function stateWithRefRewritten(
  entity: Entity,
  fromId: string,
  toId: string | null,
): EntityState | null {
  if (fromId === toId) return null
  const to = entity.id === toId ? null : toId
  switch (entity.kind) {
    case 'character': {
      const current = stateOf(entity, 'character')
      const next = { ...current }
      let changed = false
      if (current.current_location_id === fromId) {
        next.current_location_id = to
        changed = true
      }
      if (current.faction_id === fromId) {
        next.faction_id = to
        changed = true
      }
      const held = heldRewritten(current, fromId, to)
      if (held != null) {
        next.equipped_items = held.equipped_items
        next.inventory = held.inventory
        changed = true
      }
      return changed ? next : null
    }
    case 'location': {
      const current = stateOf(entity, 'location')
      return current.parent_location_id === fromId ? { ...current, parent_location_id: to } : null
    }
    case 'item': {
      const current = stateOf(entity, 'item')
      return current.at_location_id === fromId ? { ...current, at_location_id: to } : null
    }
    case 'faction':
      return null
  }
}

/** The other entities whose state names `targetId` in a ref field. */
export function referencingEntities(targetId: string, branchEntities: readonly Entity[]): Entity[] {
  return branchEntities.filter(
    (e) => e.id !== targetId && stateWithRefRewritten(e, targetId, null) != null,
  )
}

export type EntityLinkRows = {
  awareness: HappeningAwareness[]
  involvements: HappeningInvolvement[]
  relationships: CharacterRelationship[]
}

/**
 * The link rows the entity arm's cascade removes with `id`, by `entityCascade`'s predicates
 * (lib/actions/entities/entity-cascade.ts): a new cascade link table needs a list here.
 */
export function entityLinkRows(input: {
  branchId: string
  id: string
  awareness: Iterable<HappeningAwareness>
  involvements: Iterable<HappeningInvolvement>
  relationships: Iterable<CharacterRelationship>
}): EntityLinkRows {
  const { branchId, id } = input
  return {
    awareness: [...input.awareness].filter((a) => a.branchId === branchId && a.characterId === id),
    involvements: [...input.involvements].filter(
      (i) => i.branchId === branchId && i.entityId === id,
    ),
    relationships: [...input.relationships].filter(
      (r) => r.branchId === branchId && (r.aId === id || r.bId === id),
    ),
  }
}

function heldBy(entity: Entity): string[] {
  return entity.kind === 'character' ? heldItems(stateOf(entity, 'character')) : []
}

/** An item is placed at a location or carried by some character in the branch. */
export function itemHasPosition(item: Entity, branchEntities: readonly Entity[]): boolean {
  return (
    stateOf(item, 'item').at_location_id != null ||
    branchEntities.some((e) => heldBy(e).includes(item.id))
  )
}

/**
 * Holders of `loser` left without the item when it merges into `canonical`: `canonical` already has
 * a position so they don't move to it, and they don't hold it (a holder of both copies keeps one).
 */
export function holdersLosingItem(
  loser: Entity,
  canonical: Entity,
  branchEntities: readonly Entity[],
): number {
  if (!itemHasPosition(canonical, branchEntities)) return 0
  return branchEntities.filter(
    (e) => heldBy(e).includes(loser.id) && !heldBy(e).includes(canonical.id),
  ).length
}

/** Items `holderId` carries that lie nowhere and that no other entity holds. */
export function unheldItemsWithout(holderId: string, branchEntities: readonly Entity[]): number {
  const holder = branchEntities.find((e) => e.id === holderId)
  if (holder == null) return 0
  const carried = new Set(heldBy(holder))
  const heldElsewhere = new Set(
    branchEntities.filter((e) => e.id !== holderId).flatMap((e) => heldBy(e)),
  )
  return branchEntities.filter(
    (item) =>
      item.kind === 'item' &&
      carried.has(item.id) &&
      !heldElsewhere.has(item.id) &&
      stateOf(item, 'item').at_location_id == null,
  ).length
}
