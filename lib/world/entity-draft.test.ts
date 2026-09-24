import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import {
  characterDraftFrom,
  characterDraftSchema,
  factionDraftFrom,
  locationDraftFrom,
  locationDraftSchema,
} from './entity-draft'

const KAEL: Entity = {
  id: 'char_kael',
  branchId: 'br_1',
  kind: 'character',
  name: 'Kael',
  description: null,
  status: 'active',
  retiredReason: null,
  injectionMode: 'always',
  nameCollisionFlag: 0,
  state: {
    visual: { hair: 'dark' },
    traits: ['wary'],
    drives: [],
    current_location_id: 'loc_hollow',
    equipped_items: ['item_blade'],
    inventory: [],
    stackables: { gold: 5 },
    faction_id: null,
    lastSeenAt: null,
  },
  tags: ['courier'],
  keywords: ['the courier'],
  priority: 30,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

function issues(result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) {
  return result.success
    ? []
    : (result.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message }))
}

describe('characterDraftFrom', () => {
  it('flattens state into one field per control and orients relationships', () => {
    const draft = characterDraftFrom(KAEL, [
      { rowId: 'rel_1', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: null },
    ])
    expect(draft).toMatchObject({
      name: 'Kael',
      description: '',
      retiredReason: '',
      visualHair: 'dark',
      visualFace: '',
      voice: '',
      currentLocationId: 'loc_hollow',
      factionId: null,
      equippedItems: ['item_blade'],
      stackables: [{ key: 'gold', count: 5 }],
      relationships: [{ otherId: 'char_mira', selfToOther: 'ally', otherToSelf: '' }],
    })
  })

  it('starts create mode from the schema defaults with no relationships', () => {
    const draft = characterDraftFrom(null, [
      { rowId: 'rel_1', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: null },
    ])
    expect(draft).toMatchObject({
      name: '',
      status: 'active',
      injectionMode: 'auto',
      priority: 0,
      traits: [],
      currentLocationId: null,
      relationships: [],
    })
  })

  it('reads a null stored state as the empty state', () => {
    expect(locationDraftFrom({ ...KAEL, kind: 'location', state: null })).toMatchObject({
      parentLocationId: null,
      condition: '',
    })
    expect(factionDraftFrom({ ...KAEL, kind: 'faction', state: null })).toMatchObject({
      standing: '',
      agenda: [],
    })
  })
})

describe('draft schemas', () => {
  const base = characterDraftFrom(KAEL, [])

  it('requires a name and a whole-number priority in 0..100', () => {
    expect(issues(characterDraftSchema.safeParse({ ...base, name: '  ', priority: 101 }))).toEqual([
      { path: ['name'], message: 'nameRequired' },
      { path: ['priority'], message: 'priorityRange' },
    ])
    expect(
      issues(
        locationDraftSchema.safeParse({ ...locationDraftFrom(null), name: 'x', priority: 2.5 }),
      ),
    ).toEqual([{ path: ['priority'], message: 'priorityRange' }])
  })

  it('flags a quantity key repeated under different case, and a negative count', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      stackables: [
        { key: 'Gold', count: 1 },
        { key: 'gold ', count: -1 },
      ],
    })
    expect(issues(result)).toEqual(
      expect.arrayContaining([{ path: ['stackables', 1, 'count'], message: 'stackableCount' }]),
    )
    const dupes = characterDraftSchema.safeParse({
      ...base,
      stackables: [
        { key: 'Gold', count: 1 },
        { key: 'gold ', count: 2 },
      ],
    })
    expect(issues(dupes)).toEqual([
      { path: ['stackables', 1, 'key'], message: 'duplicateStackable' },
    ])
  })

  it('needs a character and at least one view per relationship, once per character', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      relationships: [
        { otherId: '', selfToOther: 'ally', otherToSelf: '' },
        { otherId: 'char_mira', selfToOther: ' ', otherToSelf: '' },
      ],
    })
    // zod 4 runs superRefine alongside inner-field issues (verified on 4.4.3 during planning).
    expect(issues(result)).toEqual([
      { path: ['relationships', 0, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 1, 'selfToOther'], message: 'relationshipPovRequired' },
    ])
    const refined = characterDraftSchema.safeParse({
      ...base,
      relationships: [
        { otherId: '', selfToOther: 'a', otherToSelf: '' },
        { otherId: '', selfToOther: 'b', otherToSelf: '' },
        { otherId: 'char_vorne', selfToOther: 'rival', otherToSelf: '' },
        { otherId: 'char_vorne', selfToOther: '', otherToSelf: 'rival' },
      ],
    })
    // Two unpicked cards are not duplicates of each other; a repeated character is.
    expect(issues(refined)).toEqual([
      { path: ['relationships', 0, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 1, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 3, 'otherId'], message: 'duplicateRelationship' },
    ])
  })
})
