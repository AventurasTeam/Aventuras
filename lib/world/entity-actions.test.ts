import { describe, expect, it } from 'vitest'

import type { CharacterState, Entity } from '@/lib/db'

import { entityActions } from './entity-actions'
import { characterDraftFrom, locationDraftFrom } from './entity-draft'

const KAEL_STATE: CharacterState = {
  visual: { hair: 'dark', attire: ' travel-worn leathers ' },
  traits: ['wary'],
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
  description: 'A courier.',
  status: 'active',
  retiredReason: null,
  injectionMode: 'always',
  nameCollisionFlag: 0,
  state: KAEL_STATE,
  tags: ['courier'],
  keywords: ['the courier', 'The Courier'],
  priority: 30,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

const MIRA_LINK = { rowId: 'rel_1', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'ally' }
const AT = { branchId: 'br_1', id: 'char_kael', now: 42 }

function update(draft: ReturnType<typeof characterDraftFrom>, links = [MIRA_LINK]) {
  return entityActions({ kind: 'character', row: KAEL, draft, relationships: links, ...AT })
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
    expect(changed.kind === 'updateEntity' && changed.payload.patch.state).toMatchObject({
      stackables: { gold: 7, arrows: 12 },
    })
    const [emptied] = update({
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      stackables: [{ key: 'Gold', count: 0 }],
    })
    expect(emptied.kind === 'updateEntity' && emptied.payload.patch.state).not.toHaveProperty(
      'stackables',
    )
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
})

describe('entityActions — relationships', () => {
  it('upserts a new pair with both views, and nothing for an unchanged one', () => {
    const draft = {
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      relationships: [
        { otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'ally' },
        { otherId: 'char_vorne', selfToOther: 'rival', otherToSelf: '' },
      ],
    }
    expect(update(draft)).toEqual([
      {
        kind: 'upsertCharacterRelationship',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          subjectId: 'char_kael',
          objectId: 'char_vorne',
          kind: 'rival',
          inverseKind: null,
        },
      },
    ])
  })

  it('deletes a removed pair by its row id, and rewrites both views on a one-view edit', () => {
    expect(update({ ...characterDraftFrom(KAEL, [MIRA_LINK]), relationships: [] })).toEqual([
      {
        kind: 'deleteCharacterRelationship',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'rel_1' },
      },
    ])
    const [edited] = update({
      ...characterDraftFrom(KAEL, [MIRA_LINK]),
      relationships: [{ otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'wary of you' }],
    })
    expect(edited).toMatchObject({
      kind: 'upsertCharacterRelationship',
      payload: { kind: 'ally', inverseKind: 'wary of you' },
    })
  })
})

describe('entityActions — create', () => {
  it('creates a location with trimmed text and an empty state', () => {
    const draft = { ...locationDraftFrom(null), name: ' The Salt Wells ' }
    expect(
      entityActions({
        kind: 'location',
        row: null,
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

  it('creates a character before the relationships that point at its new id', () => {
    const draft = {
      ...characterDraftFrom(null, []),
      name: 'Sable',
      relationships: [{ otherId: 'char_kael', selfToOther: '', otherToSelf: 'debtor' }],
    }
    const actions = entityActions({
      kind: 'character',
      row: null,
      draft,
      relationships: [],
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
