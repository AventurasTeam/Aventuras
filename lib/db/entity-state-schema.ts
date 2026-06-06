import { z } from 'zod'

import type {
  CharacterState,
  EntityState,
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

const visualSchema = z.object({
  physique: z.string().max(500).optional(),
  face: z.string().max(500).optional(),
  hair: z.string().max(500).optional(),
  eyes: z.string().max(500).optional(),
  attire: z.string().max(500).optional(),
  distinguishing: z.array(z.string().max(500)).max(20).optional(),
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
    distinguishing: z.array(z.string()).optional(),
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

export function emptyEntityState(kind: EntityKind): EntityState {
  switch (kind) {
    case 'character':
      return {
        visual: {},
        traits: [],
        drives: [],
        current_location_id: null,
        equipped_items: [],
        inventory: [],
        faction_id: null,
        lastSeenAt: null,
      }
    case 'location':
      return { parent_location_id: null }
    case 'item':
      return { at_location_id: null }
    case 'faction':
      return {}
  }
}

// Compile-time guards: each per-kind Zod output must be assignable to its gate-owned TS type.
type _CharOk = z.infer<typeof characterStateSchema> extends CharacterState ? true : never
type _LocOk = z.infer<typeof locationStateSchema> extends LocationState ? true : never
type _ItemOk = z.infer<typeof itemStateSchema> extends ItemState ? true : never
type _FacOk = z.infer<typeof factionStateSchema> extends FactionState ? true : never
const _checks: [_CharOk, _LocOk, _ItemOk, _FacOk] = [true, true, true, true]
void _checks
