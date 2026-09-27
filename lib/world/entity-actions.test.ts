import { describe, expect, it } from 'vitest'

import { emptyEntityState, type CharacterState, type Entity } from '@/lib/db'

import { entityActions } from './entity-actions'
import {
  characterDraftFrom,
  factionDraftFrom,
  itemDraftFrom,
  locationDraftFrom,
  type RelationshipDraft,
  type RelationshipLink,
} from './entity-draft'

const KAEL_STATE: CharacterState = {
  visual: { hair: 'dark', attire: ' travel-worn leathers ' },
  traits: ['wary '],
  drives: [],
  current_location_id: 'loc_hollow',
  equipped_items: ['item_blade'],
  inventory: [],
  stackables: { Gold: 5 },
  faction_id: null,
  lastSeenAt: { entryId: 'e_1', locationId: 'loc_hollow', worldTime: 10 },
}

const KAEL: Entity = {
  id: 'char_kael',
  branchId: 'br_1',
  kind: 'character',
  name: 'Kael',
  description: ' A courier. ',
  status: 'active',
  retiredReason: null,
  injectionMode: 'always',
  nameCollisionFlag: 0,
  state: KAEL_STATE,
  tags: [' courier'],
  keywords: ['the courier', 'The Courier'],
  priority: 30,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

const MIRA_LINK = {
  rowId: 'rel_1',
  otherId: 'char_mira',
  selfToOther: ' ally',
  otherToSelf: 'ally',
}
const AT = { branchId: 'br_1', id: 'char_kael', now: 42 }

function upsert(objectId: string, kind: string | null, inverseKind: string | null) {
  return {
    kind: 'upsertCharacterRelationship',
    source: 'user_edit',
    payload: { branchId: 'br_1', subjectId: 'char_kael', objectId, kind, inverseKind },
  }
}

function remove(id: string) {
  return {
    kind: 'deleteCharacterRelationship',
    source: 'user_edit',
    payload: { branchId: 'br_1', id },
  }
}

function update(draft: ReturnType<typeof characterDraftFrom>, links = [MIRA_LINK]) {
  return entityActions({
    branchEntities: [],
    kind: 'character',
    row: KAEL,
    keywordsBase: KAEL.keywords,
    draft,
    relationships: links,
    relationshipsBase: links,
    ...AT,
  })
}

describe('entityActions — update', () => {
  it('writes nothing for an untouched draft, however the classifier stored its text', () => {
    expect(update(characterDraftFrom(KAEL, [MIRA_LINK]))).toEqual([])
  })

  it('carries description, one visual field and a tag in one updateEntity', () => {
    const draft = {
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      description: 'A courier turned fugitive.',
      visualHair: 'dark, rain-soaked',
      tags: ['courier', 'fugitive'],
    }
    expect(update(draft)).toEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'char_kael',
          patch: {
            description: 'A courier turned fugitive.',
            tags: ['courier', 'fugitive'],
            state: { ...KAEL_STATE, visual: { ...KAEL_STATE.visual, hair: 'dark, rain-soaked' } },
          },
        },
      },
    ])
  })

  it('removes a blanked visual key and keeps lastSeenAt untouched', () => {
    const [action] = update({ ...characterDraftFrom(KAEL, [MIRA_LINK]), visualHair: '  ' })
    expect(action.kind === 'updateEntity' && action.payload.patch.state).toEqual({
      ...KAEL_STATE,
      visual: { attire: ' travel-worn leathers ' },
    })
  })

  it('stores quantity keys lowercase and removes a quantity set to 0', () => {
    const [changed] = update({
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      stackables: [
        { key: 'Gold', count: 7 },
        { key: ' Arrows ', count: 12 },
      ],
    })
    const changedState =
      changed.kind === 'updateEntity' ? (changed.payload.patch.state as CharacterState) : null
    expect(changedState?.stackables).toEqual({ gold: 7, arrows: 12 })
    const [emptied] = update({
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      stackables: [{ key: 'Gold', count: 0 }],
    })
    expect(emptied.kind === 'updateEntity' && emptied.payload.patch.state).not.toHaveProperty(
      'stackables',
    )
  })

  it('stores a quantity keyed like an Object.prototype member', () => {
    const [action] = update({
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      stackables: [{ key: '__proto__', count: 3 }],
    })
    const state =
      action.kind === 'updateEntity' ? (action.payload.patch.state as CharacterState) : null
    expect(Object.entries(state?.stackables ?? {})).toEqual([['__proto__', 3]])
  })

  it('collapses keyword case variants on commit', () => {
    const [action] = update({
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      keywords: ['the courier', 'The Courier', 'Grey Wolf', 'grey wolf'],
    })
    expect(action.kind === 'updateEntity' && action.payload.patch.keywords).toEqual([
      'the courier',
      'Grey Wolf',
    ])
  })

  it('drops a blanked item condition key', () => {
    const rope: Entity = {
      ...KAEL,
      id: 'item_rope',
      kind: 'item',
      name: 'Rope',
      state: { at_location_id: 'loc_hollow', condition: 'rusted' },
    }
    const draft = { ...itemDraftFrom(rope), condition: '' }
    expect(
      entityActions({
        branchEntities: [],
        kind: 'item',
        row: rope,
        keywordsBase: rope.keywords,
        draft,
        ...AT,
        id: 'item_rope',
      }),
    ).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'item_rope',
          patch: { state: { at_location_id: 'loc_hollow' } },
        },
      },
    ])
  })

  it('drops an emptied faction agenda key', () => {
    const guild: Entity = {
      ...KAEL,
      id: 'fac_guild',
      kind: 'faction',
      name: 'Salt Guild',
      state: { standing: 'feared', agenda: ['x'] },
    }
    const draft = { ...factionDraftFrom(guild), agenda: [] }
    expect(
      entityActions({
        branchEntities: [],
        kind: 'faction',
        row: guild,
        keywordsBase: guild.keywords,
        draft,
        ...AT,
        id: 'fac_guild',
      }),
    ).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'fac_guild', patch: { state: { standing: 'feared' } } },
      },
    ])
  })

  it('refuses a row saved as another kind', () => {
    expect(() =>
      entityActions({
        branchEntities: [],
        kind: 'location',
        row: KAEL,
        keywordsBase: KAEL.keywords,
        draft: locationDraftFrom(KAEL),
        ...AT,
      }),
    ).toThrow('entityActions: character row saved as location')
  })
})

describe('entityActions — relationships', () => {
  it('upserts a new pair with both views, and nothing for an unchanged one', () => {
    const draft = {
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      relationships: [
        { cardKey: 'card_mira', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'ally' },
        { cardKey: 'card_vorne', otherId: 'char_vorne', selfToOther: 'rival', otherToSelf: '' },
      ],
    }
    expect(update(draft)).toEqual([upsert('char_vorne', 'rival', null)])
  })

  it('deletes a removed pair by its row id, and sends both views on a one-view edit', () => {
    expect(update({ ...characterDraftFrom(KAEL, [MIRA_LINK]), relationships: [] })).toEqual([
      remove('rel_1'),
    ])
    expect(
      update({
        ...characterDraftFrom(KAEL, [MIRA_LINK]),
        relationships: [
          {
            cardKey: 'card_mira',
            otherId: 'char_mira',
            selfToOther: 'ally',
            otherToSelf: 'wary of you',
          },
        ],
      }),
    ).toEqual([upsert('char_mira', ' ally', 'wary of you')])
  })

  it('keeps the stored raw text of the view the user left alone', () => {
    const link = {
      rowId: 'rel_1',
      otherId: 'char_mira',
      selfToOther: ' ally ',
      otherToSelf: 'ally',
    }
    const draft = {
      ...characterDraftFrom(KAEL, [link]),
      relationships: [
        { cardKey: 'card_mira', otherId: 'char_mira', selfToOther: ' ally ', otherToSelf: 'wary' },
      ],
    }
    expect(update(draft, [link])).toEqual([upsert('char_mira', ' ally ', 'wary')])
  })
})

describe('entityActions — relationships, three-way', () => {
  const mira = (selfToOther: string | null, otherToSelf: string | null): RelationshipLink => ({
    rowId: 'rel_1',
    otherId: 'char_mira',
    selfToOther,
    otherToSelf,
  })
  const vorne = (selfToOther: string | null): RelationshipLink => ({
    rowId: 'rel_2',
    otherId: 'char_vorne',
    selfToOther,
    otherToSelf: null,
  })

  function threeWay(
    relationships: RelationshipDraft[],
    current: readonly RelationshipLink[],
    base: readonly RelationshipLink[],
  ) {
    return entityActions({
      branchEntities: [],
      kind: 'character',
      row: KAEL,
      keywordsBase: KAEL.keywords,
      draft: { ...characterDraftFrom(KAEL, base), relationships },
      relationships: current,
      relationshipsBase: base,
      ...AT,
    })
  }

  it('leaves a pair added after the baseline alone', () => {
    expect(
      threeWay(
        [{ cardKey: 'card_mira', otherId: 'char_mira', selfToOther: ' ally', otherToSelf: 'wary' }],
        [MIRA_LINK, vorne('rival')],
        [MIRA_LINK],
      ),
    ).toEqual([upsert('char_mira', ' ally', 'wary')])
  })

  it('keeps the text the classifier stored in a view the user left alone', () => {
    expect(
      threeWay(
        [
          {
            cardKey: 'card_mira',
            otherId: 'char_mira',
            selfToOther: 'friend',
            otherToSelf: 'ally',
          },
        ],
        [mira('ally', 'fond of you')],
        [mira('ally', 'ally')],
      ),
    ).toEqual([upsert('char_mira', 'friend', 'fond of you')])
  })

  it('does not write an untouched pair the classifier changed', () => {
    expect(
      threeWay(
        [
          { cardKey: 'card_mira', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'wary' },
          { cardKey: 'card_vorne', otherId: 'char_vorne', selfToOther: 'rival', otherToSelf: '' },
        ],
        [mira('ally', 'ally'), vorne('enemy')],
        [mira('ally', 'ally'), vorne('rival')],
      ),
    ).toEqual([upsert('char_mira', 'ally', 'wary')])
  })

  it('keeps what is stored in a view the user left blank on a pair new to the draft', () => {
    expect(
      threeWay(
        [{ cardKey: 'card_vorne', otherId: 'char_vorne', selfToOther: 'enemy', otherToSelf: '' }],
        [{ ...vorne('ally'), otherToSelf: 'rival' }],
        [],
      ),
    ).toEqual([upsert('char_vorne', 'enemy', 'rival')])
  })

  it('rewrites an edited pair whose row has gone with the view the user saw', () => {
    expect(
      threeWay(
        [
          {
            cardKey: 'card_mira',
            otherId: 'char_mira',
            selfToOther: 'friend',
            otherToSelf: 'ally',
          },
        ],
        [],
        [mira('ally', 'ally')],
      ),
    ).toEqual([upsert('char_mira', 'friend', 'ally')])
  })

  it('does not bring back an untouched pair whose row has gone', () => {
    expect(
      threeWay(
        [{ cardKey: 'card_mira', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'ally' }],
        [],
        [mira('ally', 'ally')],
      ),
    ).toEqual([])
  })

  it('deletes the current row of a removed pair, and nothing for a pair already gone', () => {
    expect(threeWay([], [{ ...MIRA_LINK, rowId: 'rel_9' }], [MIRA_LINK])).toEqual([remove('rel_9')])
    expect(threeWay([], [], [MIRA_LINK])).toEqual([])
  })

  it('deletes the row when both views resolve to null', () => {
    expect(
      threeWay(
        [{ cardKey: 'card_mira', otherId: 'char_mira', selfToOther: '', otherToSelf: 'rival' }],
        [mira('ally', null)],
        [mira('ally', 'rival')],
      ),
    ).toEqual([remove('rel_1')])
  })

  it('writes nothing for an edit back to what is now stored', () => {
    expect(
      threeWay(
        [{ cardKey: 'card_mira', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'wary' }],
        [mira('ally', 'wary ')],
        [mira('ally', 'ally')],
      ),
    ).toEqual([])
  })
})

describe('entityActions — create', () => {
  it('creates a location with trimmed text and an empty state', () => {
    const draft = { ...locationDraftFrom(null), name: ' The Salt Wells ' }
    expect(
      entityActions({
        branchEntities: [],
        kind: 'location',
        row: null,
        keywordsBase: [],
        draft,
        branchId: 'br_1',
        id: 'loc_new',
        now: 42,
      }),
    ).toEqual([
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: {
          entry: {
            id: 'loc_new',
            branchId: 'br_1',
            kind: 'location',
            name: 'The Salt Wells',
            description: null,
            status: 'active',
            retiredReason: null,
            injectionMode: 'auto',
            tags: [],
            keywords: [],
            priority: 0,
            state: { parent_location_id: null },
            embeddingStale: 1,
            createdAt: 42,
            updatedAt: 42,
          },
        },
      },
    ])
  })

  it('creates an untouched character over the empty character state', () => {
    const actions = entityActions({
      branchEntities: [],
      kind: 'character',
      row: null,
      keywordsBase: [],
      draft: characterDraftFrom(null, []),
      relationships: [],
      relationshipsBase: [],
      branchId: 'br_1',
      id: 'char_new',
      now: 42,
    })
    expect(actions.map((a) => a.kind)).toEqual(['createEntity'])
    expect(actions[0].kind === 'createEntity' && actions[0].payload.entry.state).toEqual(
      emptyEntityState('character'),
    )
  })

  it('creates a character before the relationships that point at its new id', () => {
    const draft = {
      ...characterDraftFrom(null, []),
      name: 'Sable',
      relationships: [
        { cardKey: 'card_kael', otherId: 'char_kael', selfToOther: '', otherToSelf: 'debtor' },
      ],
    }
    const actions = entityActions({
      branchEntities: [],
      kind: 'character',
      row: null,
      keywordsBase: [],
      draft,
      relationships: [],
      relationshipsBase: [],
      branchId: 'br_1',
      id: 'char_new',
      now: 42,
    })
    expect(actions.map((a) => a.kind)).toEqual(['createEntity', 'upsertCharacterRelationship'])
    expect(actions[1]).toMatchObject({
      payload: { subjectId: 'char_new', objectId: 'char_kael', kind: null, inverseKind: 'debtor' },
    })
  })
})

// A classifier alias can land while the pane has keywords dirty; Save merges the user's changes.
describe('entityActions — keywords against the stored list', () => {
  const place = (keywords: string[]): Entity => ({
    ...KAEL,
    id: 'loc_keep',
    kind: 'location',
    name: 'Keep',
    state: { parent_location_id: null },
    keywords,
  })
  const savedKeywords = (stored: string[], base: string[], draft: string[]) => {
    const row = place(stored)
    const [action] = entityActions({
      branchEntities: [],
      kind: 'location',
      row,
      draft: { ...locationDraftFrom(row), keywords: draft },
      keywordsBase: base,
      ...AT,
      id: 'loc_keep',
    })
    return action?.kind === 'updateEntity' ? action.payload.patch.keywords : undefined
  }

  it('writes the list as edited while the stored one is still its base', () => {
    expect(savedKeywords(['a', 'b'], ['a', 'b'], ['b', 'a', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('keeps an alias the classifier appended since the base', () => {
    expect(savedKeywords(['a', 'b', 'z'], ['a', 'b'], ['a', 'b', 'c'])).toEqual([
      'a',
      'b',
      'z',
      'c',
    ])
  })

  it('drops what the user removed and keeps the append', () => {
    expect(savedKeywords(['a', 'b', 'z'], ['a', 'b'], ['a'])).toEqual(['a', 'z'])
  })

  it("keeps the user's spelling of a term they kept", () => {
    expect(savedKeywords(['grey wolf', 'z'], ['grey wolf'], ['Grey Wolf'])).toEqual([
      'Grey Wolf',
      'z',
    ])
  })

  it('writes nothing when the merge leaves the stored list as it is', () => {
    expect(savedKeywords(['a', 'z'], ['a'], ['a', 'z'])).toBeUndefined()
  })
})

describe('one position per item', () => {
  const MIRA: Entity = {
    ...KAEL,
    id: 'char_mira',
    name: 'Mira',
    state: { ...KAEL_STATE, equipped_items: [], inventory: ['item_rope', 'item_key'] },
  }
  const ROPE: Entity = {
    ...KAEL,
    id: 'item_rope',
    kind: 'item',
    name: 'Rope',
    state: { at_location_id: 'loc_hollow' },
  }
  const BLADE: Entity = {
    ...ROPE,
    id: 'item_blade',
    name: 'Blade',
    state: { at_location_id: null },
  }
  const positions = (actions: ReturnType<typeof entityActions>) =>
    actions.filter((a) => a.kind === 'updateItemPosition' || a.kind === 'updateEntityInventory')

  it('takes an item a character picks up off its other holder and out of where it lay', () => {
    const draft = { ...characterDraftFrom(KAEL, []), inventory: ['item_rope'] }
    expect(
      positions(
        entityActions({
          branchEntities: [KAEL, MIRA, ROPE, BLADE],
          kind: 'character',
          row: KAEL,
          keywordsBase: KAEL.keywords,
          draft,
          relationships: [],
          relationshipsBase: [],
          ...AT,
        }),
      ),
    ).toStrictEqual([
      {
        kind: 'updateEntityInventory',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'char_mira', equipped_items: [], inventory: ['item_key'] },
      },
      {
        kind: 'updateItemPosition',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'item_rope', atLocationId: null },
      },
    ])
  })

  it('leaves an item the character already held where the other rows put it', () => {
    const doubled: Entity = { ...MIRA, state: { ...KAEL_STATE, equipped_items: ['item_blade'] } }
    const draft = { ...characterDraftFrom(KAEL, []), traits: ['bold'] }
    expect(
      positions(
        entityActions({
          branchEntities: [KAEL, doubled, BLADE],
          kind: 'character',
          row: KAEL,
          keywordsBase: KAEL.keywords,
          draft,
          relationships: [],
          relationshipsBase: [],
          ...AT,
        }),
      ),
    ).toStrictEqual([])
  })

  it('takes an item placed at a location off every holder', () => {
    const draft = { ...itemDraftFrom(BLADE), atLocationId: 'loc_hollow' }
    expect(
      positions(
        entityActions({
          branchEntities: [KAEL, MIRA, BLADE],
          kind: 'item',
          row: BLADE,
          keywordsBase: BLADE.keywords,
          draft,
          ...AT,
          id: 'item_blade',
        }),
      ),
    ).toStrictEqual([
      {
        kind: 'updateEntityInventory',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'char_kael', equipped_items: [], inventory: [] },
      },
    ])
  })
})
