import { z } from 'zod'

import type {
  CharacterState,
  EntityStateByKind,
  FactionState,
  ItemState,
  LocationState,
} from './entities-types'

export type EntityKind = 'character' | 'location' | 'item' | 'faction'

const lastSeenAtSchema = z.object({
  entryId: z.string(),
  locationId: z.string().nullable(),
  worldTime: z.number(),
})

// The categories a full-replace visual change can target — visualSchema's own keys.
// lib/piggyback duplicates this as VISUAL_CHANGE_TYPES behind a compile-time guard
// rather than importing it: lib/db is the lowest layer, and a value import in the other
// direction would drag the db barrel into scripts/mock-llm's plain-Node run.
export const VISUAL_CATEGORIES = [
  'physique',
  'face',
  'hair',
  'eyes',
  'attire',
  'distinguishing',
] as const

const visualSchema = z.object({
  physique: z.string().max(500).optional(),
  face: z.string().max(500).optional(),
  hair: z.string().max(500).optional(),
  eyes: z.string().max(500).optional(),
  attire: z.string().max(500).optional(),
  distinguishing: z.string().max(500).optional(),
})

export const characterStateSchema = z.object({
  visual: visualSchema,
  traits: z.array(z.string()).max(50),
  drives: z.array(z.string()).max(50),
  voice: z.string().max(2000).optional(),
  current_location_id: z.string().nullable(),
  equipped_items: z.array(z.string()),
  inventory: z.array(z.string()),
  stackables: z.record(z.string().min(1).max(40), z.number().int().nonnegative()).optional(),
  faction_id: z.string().nullable(),
  lastSeenAt: lastSeenAtSchema.nullable(),
})

export const locationStateSchema = z.object({
  parent_location_id: z.string().nullable(),
  condition: z.string().max(500).optional(),
})

export const itemStateSchema = z.object({
  at_location_id: z.string().nullable(),
  condition: z.string().max(500).optional(),
})

export const factionStateSchema = z.object({
  standing: z.string().max(500).optional(),
  agenda: z.array(z.string()).max(50).optional(),
})

// Encoder-only: ONE walkable z.object spanning every kind's fields, each carrying its
// TRUE per-kind optional|nullable flag (never "optional because absent in another kind").
// Never .parse()'d — a "required" field absent for a non-matching kind is inert (ABSENT->NOCHANGE).
// No .max bounds: the delta encoder reads node type + optional/nullable flags only.
export const entityStateColumnSchema = z.object({
  visual: z.object({
    physique: z.string().optional(),
    face: z.string().optional(),
    hair: z.string().optional(),
    eyes: z.string().optional(),
    attire: z.string().optional(),
    distinguishing: z.string().optional(),
  }),
  traits: z.array(z.string()),
  drives: z.array(z.string()),
  voice: z.string().optional(),
  current_location_id: z.string().nullable(),
  equipped_items: z.array(z.string()),
  inventory: z.array(z.string()),
  stackables: z.record(z.string(), z.number()).optional(),
  faction_id: z.string().nullable(),
  lastSeenAt: lastSeenAtSchema.nullable(),
  parent_location_id: z.string().nullable(),
  condition: z.string().optional(),
  at_location_id: z.string().nullable(),
  standing: z.string().optional(),
  agenda: z.array(z.string()).optional(),
})

export function entityStateSchemaForKind(kind: EntityKind) {
  switch (kind) {
    case 'character':
      return characterStateSchema
    case 'location':
      return locationStateSchema
    case 'item':
      return itemStateSchema
    case 'faction':
      return factionStateSchema
  }
}

// Per-kind factories behind a `satisfies` map rather than one switch returning
// EntityState: FactionState is all-optional, so the wide union is assignable to
// it and a caller pairing `kind: 'faction'` with a character's empty state would
// otherwise compile.
const EMPTY_STATE_BY_KIND = {
  character: (): CharacterState => ({
    visual: {},
    traits: [],
    drives: [],
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: null,
    lastSeenAt: null,
  }),
  location: (): LocationState => ({ parent_location_id: null }),
  item: (): ItemState => ({ at_location_id: null }),
  faction: (): FactionState => ({}),
} satisfies { [K in EntityKind]: () => EntityStateByKind[K] }

export function emptyEntityState<K extends EntityKind>(kind: K): EntityStateByKind[K] {
  // The `satisfies` above is the proof each factory returns its own kind's
  // shape; TS just can't distribute that over a call indexed by a generic key.
  return EMPTY_STATE_BY_KIND[kind]() as EntityStateByKind[K]
}

// Compile-time guards: each per-kind Zod output must be assignable to its gate-owned TS type.
type _CharOk = z.infer<typeof characterStateSchema> extends CharacterState ? true : never
type _LocOk = z.infer<typeof locationStateSchema> extends LocationState ? true : never
type _ItemOk = z.infer<typeof itemStateSchema> extends ItemState ? true : never
type _FacOk = z.infer<typeof factionStateSchema> extends FactionState ? true : never
// …and the kind→state map must span exactly the kinds this module dispatches on,
// so a fifth kind can't reach entityStateSchemaForKind without a state shape.
type _KindMapOk = keyof EntityStateByKind extends EntityKind
  ? EntityKind extends keyof EntityStateByKind
    ? true
    : never
  : never
const _checks: [_CharOk, _LocOk, _ItemOk, _FacOk, _KindMapOk] = [true, true, true, true, true]
void _checks
