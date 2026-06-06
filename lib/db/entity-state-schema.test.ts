import { describe, expect, it } from 'vitest'

import { applyUndoPayload, computeUndoPayload } from '@/lib/actions'

import {
  characterStateSchema,
  entityStateColumnSchema,
  factionStateSchema,
  itemStateSchema,
  locationStateSchema,
} from './entity-state-schema'

describe('per-kind state schemas', () => {
  it('parses a representative state for each kind', () => {
    expect(
      characterStateSchema.safeParse({
        visual: { attire: 'cloak', distinguishing: ['scar'] },
        traits: ['brave'],
        drives: ['vengeance'],
        voice: 'gruff',
        current_location_id: 'loc_1',
        equipped_items: ['item_1'],
        inventory: [],
        stackables: { gold: 5 },
        faction_id: 'fact_1',
        lastSeenAt: { entryId: 'entry_1', locationId: 'loc_1', worldTime: 10 },
      }).success,
    ).toBe(true)
    expect(
      locationStateSchema.safeParse({ parent_location_id: 'loc_2', condition: 'war-damaged' })
        .success,
    ).toBe(true)
    expect(itemStateSchema.safeParse({ at_location_id: null, condition: 'broken' }).success).toBe(
      true,
    )
    expect(
      factionStateSchema.safeParse({ standing: 'ascendant', agenda: ['expand'] }).success,
    ).toBe(true)
  })

  it('rejects values past the degradation bounds', () => {
    const base = {
      visual: {},
      traits: [],
      drives: [],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: null,
    }
    expect(characterStateSchema.safeParse({ ...base, traits: Array(51).fill('x') }).success).toBe(
      false,
    )
    expect(characterStateSchema.safeParse({ ...base, voice: 'x'.repeat(2001) }).success).toBe(false)
    expect(characterStateSchema.safeParse({ ...base, stackables: { gold: -1 } }).success).toBe(
      false,
    )
  })
})

describe('entityStateColumnSchema round-trips through the encoder', () => {
  const prior = {
    visual: { attire: 'cloak' },
    traits: ['brave'],
    drives: [],
    current_location_id: 'loc_1',
    equipped_items: [],
    inventory: [],
    stackables: { gold: 5 },
    faction_id: null,
    lastSeenAt: null,
  }

  it('restores nested-object, nullable-leaf, and record changes', () => {
    const next = {
      ...prior,
      visual: { attire: 'armor' }, // nested-object change
      current_location_id: null, // nullable-leaf non-null -> null
      stackables: { gold: 5, arrows: 12 }, // record add
    }
    const undo = computeUndoPayload(entityStateColumnSchema, prior, next)
    const restored = applyUndoPayload(entityStateColumnSchema, next, undo)
    expect(restored).toEqual(prior)
  })
})
