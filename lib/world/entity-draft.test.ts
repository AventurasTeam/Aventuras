import { describe, expect, it } from 'vitest'

import { VISUAL_CATEGORIES, type CharacterState, type Entity } from '@/lib/db'

import {
  characterDraftFrom,
  characterDraftSchema,
  factionDraftFrom,
  factionDraftSchema,
  itemDraftFrom,
  itemDraftSchema,
  locationDraftFrom,
  locationDraftSchema,
  VISUAL_DRAFT_FIELDS,
} from './entity-draft'

const KAEL_STATE: CharacterState = {
  visual: {
    physique: 'lean',
    face: 'scarred jaw',
    hair: 'dark',
    eyes: 'grey',
    attire: 'travel cloak',
    distinguishing: 'burned left hand',
  },
  traits: ['wary'],
  drives: ['deliver the letter'],
  voice: 'clipped',
  current_location_id: 'loc_hollow',
  equipped_items: ['item_blade'],
  inventory: ['item_map'],
  stackables: { gold: 5 },
  faction_id: 'fac_wardens',
  lastSeenAt: null,
}

const KAEL: Entity = {
  id: 'char_kael',
  branchId: 'br_1',
  kind: 'character',
  name: 'Kael',
  description: 'Carries sealed letters across the marches.',
  status: 'staged',
  retiredReason: 'Left the guild after the ambush.',
  injectionMode: 'always',
  nameCollisionFlag: 0,
  state: KAEL_STATE,
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
    expect(draft).toEqual({
      name: 'Kael',
      description: 'Carries sealed letters across the marches.',
      status: 'staged',
      retiredReason: 'Left the guild after the ambush.',
      injectionMode: 'always',
      keywords: ['the courier'],
      tags: ['courier'],
      priority: 30,
      visualPhysique: 'lean',
      visualFace: 'scarred jaw',
      visualHair: 'dark',
      visualEyes: 'grey',
      visualAttire: 'travel cloak',
      visualDistinguishing: 'burned left hand',
      traits: ['wary'],
      drives: ['deliver the letter'],
      voice: 'clipped',
      currentLocationId: 'loc_hollow',
      factionId: 'fac_wardens',
      equippedItems: ['item_blade'],
      inventory: ['item_map'],
      stackables: [{ key: 'gold', count: 5 }],
      relationships: [
        { cardKey: 'rel_1', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: '' },
      ],
    })
  })

  it('pairs each visual draft field with its state key, in canon order', () => {
    const draft = characterDraftFrom(KAEL, [])
    for (const [field, key] of VISUAL_DRAFT_FIELDS) {
      expect(draft[field]).toBe(KAEL_STATE.visual[key])
    }
    expect(VISUAL_DRAFT_FIELDS.map(([, key]) => key)).toEqual([...VISUAL_CATEGORIES])
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

  it('reads a location and an item position and condition', () => {
    expect(
      locationDraftFrom({
        ...KAEL,
        kind: 'location',
        state: { parent_location_id: 'loc_vale', condition: 'flooded' },
      }),
    ).toMatchObject({ parentLocationId: 'loc_vale', condition: 'flooded' })
    expect(
      itemDraftFrom({
        ...KAEL,
        kind: 'item',
        state: { at_location_id: 'loc_hollow', condition: 'chipped' },
      }),
    ).toMatchObject({ atLocationId: 'loc_hollow', condition: 'chipped' })
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

  it.each([null, NaN, -1])('reports a priority of %s as out of range', (priority) => {
    expect(issues(characterDraftSchema.safeParse({ ...base, priority }))).toEqual([
      { path: ['priority'], message: 'priorityRange' },
    ])
  })

  it('reports a cleared quantity count as a count issue', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      stackables: [{ key: 'gold', count: null }],
    })
    expect(issues(result)).toEqual([
      { path: ['stackables', 0, 'count'], message: 'stackableCount' },
    ])
  })

  it('accepts a valid item and faction draft', () => {
    const item = itemDraftFrom({
      ...KAEL,
      kind: 'item',
      state: { at_location_id: 'loc_hollow', condition: 'chipped' },
    })
    expect(issues(itemDraftSchema.safeParse(item))).toEqual([])
    const faction = factionDraftFrom({
      ...KAEL,
      kind: 'faction',
      state: { standing: 'feared', agenda: ['hold the pass'] },
    })
    expect(faction).toMatchObject({ standing: 'feared', agenda: ['hold the pass'] })
    expect(issues(factionDraftSchema.safeParse(faction))).toEqual([])
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

  it('flags stored quantity keys that differ only by case', () => {
    const legacy = characterDraftFrom(
      { ...KAEL, state: { ...KAEL_STATE, stackables: { Gold: 5, gold: 3 } } },
      [],
    )
    expect(issues(characterDraftSchema.safeParse(legacy))).toEqual([
      { path: ['stackables', 1, 'key'], message: 'duplicateStackable' },
    ])
  })

  it('reports blank quantity keys as missing, not as duplicates', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      stackables: [
        { key: '', count: 1 },
        { key: '', count: 2 },
      ],
    })
    expect(issues(result)).toEqual([
      { path: ['stackables', 0, 'key'], message: 'stackableKeyRequired' },
      { path: ['stackables', 1, 'key'], message: 'stackableKeyRequired' },
    ])
  })

  it('keeps the duplicate-quantity check when priority is cleared', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      priority: null,
      stackables: [
        { key: 'Gold', count: 1 },
        { key: 'gold ', count: 2 },
      ],
    })
    expect(issues(result)).toEqual([
      { path: ['priority'], message: 'priorityRange' },
      { path: ['stackables', 1, 'key'], message: 'duplicateStackable' },
    ])
  })

  it('keeps the duplicate-quantity check when another row count is cleared', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      stackables: [
        { key: 'silver', count: null },
        { key: 'Gold', count: 1 },
        { key: 'gold ', count: 2 },
      ],
    })
    expect(issues(result)).toEqual([
      { path: ['stackables', 0, 'count'], message: 'stackableCount' },
      { path: ['stackables', 2, 'key'], message: 'duplicateStackable' },
    ])
  })

  it('needs a character and at least one view per relationship, once per character', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      relationships: [
        { cardKey: 'card_new1', otherId: '', selfToOther: 'ally', otherToSelf: '' },
        { cardKey: 'card_mira', otherId: 'char_mira', selfToOther: ' ', otherToSelf: '' },
      ],
    })
    // The cross-row checks run on the array schemas, so an inner issue elsewhere never hides them.
    expect(issues(result)).toEqual([
      { path: ['relationships', 0, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 1, 'selfToOther'], message: 'relationshipPovRequired' },
    ])
    const refined = characterDraftSchema.safeParse({
      ...base,
      relationships: [
        { cardKey: 'card_new2', otherId: '', selfToOther: 'a', otherToSelf: '' },
        { cardKey: 'card_new3', otherId: '', selfToOther: 'b', otherToSelf: '' },
        { cardKey: 'card_vorne', otherId: 'char_vorne', selfToOther: 'rival', otherToSelf: '' },
        { cardKey: 'card_vorne2', otherId: 'char_vorne', selfToOther: '', otherToSelf: 'rival' },
      ],
    })
    // Two unpicked cards are not duplicates of each other; a repeated character is.
    expect(issues(refined)).toEqual([
      { path: ['relationships', 0, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 1, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 3, 'otherId'], message: 'duplicateRelationship' },
    ])
  })

  it('keeps the relationship checks when priority is cleared', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      priority: null,
      relationships: [
        { cardKey: 'card_new4', otherId: '', selfToOther: 'ally', otherToSelf: '' },
        { cardKey: 'card_mira', otherId: 'char_mira', selfToOther: ' ', otherToSelf: '' },
      ],
    })
    expect(issues(result)).toEqual([
      { path: ['priority'], message: 'priorityRange' },
      { path: ['relationships', 0, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 1, 'selfToOther'], message: 'relationshipPovRequired' },
    ])
  })

  it('reports a missing list row instead of throwing', () => {
    const stackables = characterDraftSchema.safeParse({
      ...base,
      stackables: [null, { key: 'Gold', count: 1 }],
    })
    expect(stackables.success).toBe(false)
    expect(issues(stackables).map((i) => i.path)).toEqual([['stackables', 0]])
    const relationships = characterDraftSchema.safeParse({ ...base, relationships: [null] })
    expect(relationships.success).toBe(false)
    expect(issues(relationships).map((i) => i.path)).toEqual([['relationships', 0]])
  })

  it('keeps the relationship checks when a cleared picker leaves a row without a character', () => {
    const result = characterDraftSchema.safeParse({
      ...base,
      relationships: [
        { cardKey: 'card_new5', otherId: null, selfToOther: 'ally', otherToSelf: '' },
        { cardKey: 'card_vorne', otherId: 'char_vorne', selfToOther: '', otherToSelf: '' },
        { cardKey: 'card_vorne2', otherId: 'char_vorne', selfToOther: 'rival', otherToSelf: '' },
      ],
    })
    expect(issues(result)).toEqual([
      { path: ['relationships', 0, 'otherId'], message: 'characterRequired' },
      { path: ['relationships', 1, 'selfToOther'], message: 'relationshipPovRequired' },
      { path: ['relationships', 2, 'otherId'], message: 'duplicateRelationship' },
    ])
  })
})
