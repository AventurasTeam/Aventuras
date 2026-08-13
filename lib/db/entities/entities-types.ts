export type EntityId = string

export type CharacterState = {
  visual: {
    physique?: string
    face?: string
    hair?: string
    eyes?: string
    attire?: string
    distinguishing?: string
  }
  traits: string[]
  drives: string[]
  voice?: string
  current_location_id: EntityId | null
  equipped_items: EntityId[]
  inventory: EntityId[]
  stackables?: Record<string, number>
  faction_id: EntityId | null
  lastSeenAt: { entryId: string; locationId: string | null; worldTime: number } | null
}

export type LocationState = {
  parent_location_id: EntityId | null
  condition?: string
}

export type ItemState = {
  at_location_id: EntityId | null
  condition?: string
}

export type FactionState = {
  standing?: string
  agenda?: string[]
}

// `entities.kind` is its own column; `state` holds the per-kind shape without an
// inline discriminant. Callers that still know the kind should pair the two
// through this map — `EntityState` alone is undiscriminated, so a character's
// state is assignable to a faction row's `state` field.
export type EntityStateByKind = {
  character: CharacterState
  location: LocationState
  item: ItemState
  faction: FactionState
}

export type EntityState = EntityStateByKind[keyof EntityStateByKind]
