import type { Entity, EntityKind, VISUAL_CATEGORIES } from '@/lib/db'
import { foldStackables } from '@/lib/keyword-terms'
import { collate } from '@/lib/list-modules'
import { blankToNull } from '@/lib/text'

import { stateOf } from './entity-draft'
import { byName, itemsAt } from './overview'
import { placeModes } from './place-modes'

/** architecture.md → Entity state on the template surface: one shape for every reference. */
export type EntityRef = { id: string; name: string; status: Entity['status'] }

export type HoldingView = EntityRef & {
  description: string | null
  condition: string | null
  equipped: boolean
}

export type StackableView = { key: string; amount: number }

export type CharacterStateView = {
  visual: Readonly<Record<(typeof VISUAL_CATEGORIES)[number], string | null>>
  traits: readonly string[]
  drives: readonly string[]
  voice: string | null
  faction: EntityRef | null
  /** Active and in scene, the scene's location; otherwise the last place the character was seen. */
  location: EntityRef | null
  /** Inventory, then equipped items. */
  holdings: readonly HoldingView[]
  /** Largest amount first. */
  stackables: readonly StackableView[]
}

export type LocationStateView = { condition: string | null; parent: EntityRef | null }

export type ItemStateView = {
  condition: string | null
  location: EntityRef | null
  holder: (EntityRef & { equipped: boolean }) | null
}

export type FactionStateView = {
  standing: string | null
  agenda: readonly string[]
  members: readonly EntityRef[]
}

export type EntityStateViewByKind = {
  character: CharacterStateView
  location: LocationStateView
  item: ItemStateView
  faction: FactionStateView
}

export type EntityStateView = EntityStateViewByKind[EntityKind]

/** A kind with its own kind's view, narrowable on `kind`. */
export type KindedView = {
  [K in EntityKind]: { kind: K; state: EntityStateViewByKind[K] }
}[EntityKind]

export type EntityViews = {
  /** Every entity on the branch. */
  byId: ReadonlyMap<string, EntityStateView>
  /**
   * An entity's view as `kind`. A row these views weren't built from, or one of another kind,
   * gets the empty view: retrieval reads its rows from SQLite, the views come from the store.
   */
  of: <K extends EntityKind>(id: string, kind: K) => EntityStateViewByKind[K]
  /** `of` for a row whose kind is only known as `EntityKind`, paired so `kind` narrows `state`. */
  kinded: (id: string, kind: EntityKind) => KindedView
  /** The items `Here:` lists at a place, by name; the floor seats exactly these. */
  looseAt: (locationId: string) => readonly string[]
}

export type ViewScene = {
  sceneEntities: readonly string[]
  currentLocationId: string | null
}

const EMPTY_VIEW_BY_KIND = {
  character: (): CharacterStateView => ({
    visual: {
      physique: null,
      face: null,
      hair: null,
      eyes: null,
      attire: null,
      distinguishing: null,
    },
    traits: [],
    drives: [],
    voice: null,
    faction: null,
    location: null,
    holdings: [],
    stackables: [],
  }),
  location: (): LocationStateView => ({ condition: null, parent: null }),
  item: (): ItemStateView => ({ condition: null, location: null, holder: null }),
  faction: (): FactionStateView => ({ standing: null, agenda: [], members: [] }),
} satisfies { [K in EntityKind]: () => EntityStateViewByKind[K] }

export function emptyEntityView<K extends EntityKind>(kind: K): EntityStateViewByKind[K] {
  return EMPTY_VIEW_BY_KIND[kind]() as EntityStateViewByKind[K]
}

const text = (value: unknown): string | null =>
  typeof value === 'string' ? blankToNull(value) : null

const entries = (values: readonly unknown[] | undefined): string[] =>
  (values ?? []).flatMap((value) => {
    const kept = text(value)
    return kept === null ? [] : [kept]
  })

const refOf = (e: Entity): EntityRef => ({ id: e.id, name: e.name, status: e.status })

/**
 * architecture.md → Entity state on the template surface. Who a reference names: a disabled
 * target is left out unless the active+in-scene invariant seats it, and a place is disabled when
 * it is effectively disabled. Holdings and loose items leave out retired items too.
 */
export function buildEntityViews(entities: readonly Entity[], scene: ViewScene): EntityViews {
  const byEntityId = new Map(entities.map((e) => [e.id, e]))
  const inScene = new Set(scene.sceneEntities)
  const modes = placeModes(entities, scene.currentLocationId)

  const seatedByScene = (e: Entity): boolean => e.status === 'active' && inScene.has(e.id)
  const disabled = (e: Entity): boolean =>
    e.kind === 'location' ? modes.isDisabled(e.id) : e.injectionMode === 'disabled'
  const shown = (e: Entity): boolean => !disabled(e) || seatedByScene(e)
  const target = (id: string | null | undefined, kind: EntityKind): Entity | null => {
    const row = id == null ? undefined : byEntityId.get(id)
    return row !== undefined && row.kind === kind && shown(row) ? row : null
  }
  const ref = (id: string | null | undefined, kind: EntityKind): EntityRef | null => {
    const row = target(id, kind)
    return row === null ? null : refOf(row)
  }
  const shownItem = (id: string): Entity | null => {
    const row = target(id, 'item')
    return row === null || row.status === 'retired' ? null : row
  }

  // Indexed once: a faction's members and an item's holder are reverse lookups.
  const membersOf = new Map<string, Entity[]>()
  const holdersOf = new Map<string, { holder: Entity; equipped: boolean }[]>()
  for (const e of [...entities].sort(byName)) {
    if (e.kind !== 'character' || !shown(e)) continue
    const state = stateOf(e, 'character')
    if (state.faction_id != null) {
      const members = membersOf.get(state.faction_id) ?? []
      members.push(e)
      membersOf.set(state.faction_id, members)
    }
    const equipped = new Set(state.equipped_items ?? [])
    for (const itemId of new Set([...(state.inventory ?? []), ...(state.equipped_items ?? [])])) {
      const holders = holdersOf.get(itemId) ?? []
      holders.push({ holder: e, equipped: equipped.has(itemId) })
      holdersOf.set(itemId, holders)
    }
  }

  const characterView = (e: Entity): CharacterStateView => {
    const state = stateOf(e, 'character')
    const inventory = state.inventory ?? []
    const equippedItems = state.equipped_items ?? []
    const equipped = new Set(equippedItems)
    const holdings: HoldingView[] = []
    const held = new Set<string>()
    const hold = (id: string, isEquipped: boolean): void => {
      const item = shownItem(id)
      if (item === null || held.has(id)) return
      held.add(id)
      const itemState = stateOf(item, 'item')
      holdings.push({
        ...refOf(item),
        description: text(item.description),
        condition: text(itemState.condition),
        equipped: isEquipped,
      })
    }
    for (const id of inventory) if (!equipped.has(id)) hold(id, false)
    for (const id of equippedItems) hold(id, true)
    return {
      visual: {
        physique: text(state.visual?.physique),
        face: text(state.visual?.face),
        hair: text(state.visual?.hair),
        eyes: text(state.visual?.eyes),
        attire: text(state.visual?.attire),
        distinguishing: text(state.visual?.distinguishing),
      },
      traits: entries(state.traits),
      drives: entries(state.drives),
      voice: text(state.voice),
      faction: ref(state.faction_id, 'faction'),
      location: ref(
        seatedByScene(e) ? scene.currentLocationId : state.current_location_id,
        'location',
      ),
      holdings,
      stackables: [...foldStackables(state.stackables)]
        .map(([key, amount]) => ({ key, amount }))
        .sort((a, b) => b.amount - a.amount || collate(a.key, b.key)),
    }
  }

  const itemView = (e: Entity): ItemStateView => {
    const state = stateOf(e, 'item')
    const holders = holdersOf.get(e.id) ?? []
    // An item held twice by an older write: the in-scene holder is the one the scene list
    // dedupes against.
    const holding =
      holders.find(({ holder }) => holder.status === 'active' && inScene.has(holder.id)) ??
      holders[0]
    return {
      condition: text(state.condition),
      location: ref(state.at_location_id, 'location'),
      holder:
        holding === undefined ? null : { ...refOf(holding.holder), equipped: holding.equipped },
    }
  }

  const viewOf = (e: Entity): EntityStateView => {
    switch (e.kind) {
      case 'character':
        return characterView(e)
      case 'location': {
        const state = stateOf(e, 'location')
        return {
          condition: text(state.condition),
          parent: ref(state.parent_location_id, 'location'),
        }
      }
      case 'item':
        return itemView(e)
      case 'faction': {
        const state = stateOf(e, 'faction')
        return {
          standing: text(state.standing),
          agenda: entries(state.agenda),
          members: (membersOf.get(e.id) ?? []).map(refOf),
        }
      }
    }
  }

  const byId = new Map(entities.map((e) => [e.id, viewOf(e)]))
  const looseAt = (locationId: string): readonly string[] =>
    itemsAt(locationId, entities)
      .filter((e) => shownItem(e.id) !== null)
      .map((e) => e.id)
  const of = <K extends EntityKind>(id: string, kind: K): EntityStateViewByKind[K] =>
    byEntityId.get(id)?.kind === kind
      ? (byId.get(id) as EntityStateViewByKind[K])
      : emptyEntityView(kind)
  // A case per kind: called with the union, `of` would pair any kind with any view.
  const kinded = (id: string, kind: EntityKind): KindedView => {
    switch (kind) {
      case 'character':
        return { kind, state: of(id, kind) }
      case 'location':
        return { kind, state: of(id, kind) }
      case 'item':
        return { kind, state: of(id, kind) }
      case 'faction':
        return { kind, state: of(id, kind) }
    }
  }
  return { byId, of, kinded, looseAt }
}
