import { describe, expect, it } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import {
  emptyEntityState,
  type CharacterRelationship,
  type Entity,
  type EntityKind,
  type EntityState,
  type HappeningAwareness,
  type HappeningInvolvement,
} from '@/lib/db'

import { entityMergeActions, type EntityMergeInput } from './entity-merge'

function entity(
  id: string,
  kind: EntityKind,
  overrides: Partial<Entity> = {},
  state: Partial<EntityState> = {},
): Entity {
  return {
    id,
    branchId: 'b1',
    kind,
    name: 'Kael',
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: { ...emptyEntityState(kind), ...state } as EntityState,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const aware = (
  id: string,
  characterId: string,
  happeningId: string,
  fields: Partial<HappeningAwareness> = {},
): HappeningAwareness => ({
  id,
  branchId: 'b1',
  characterId,
  happeningId,
  learnedAtEntryId: null,
  decayResistance: null,
  retrievalCount: 0,
  source: null,
  ...fields,
})

const involved = (
  id: string,
  entityId: string,
  happeningId: string,
  role: string | null,
): HappeningInvolvement => ({ id, branchId: 'b1', entityId, happeningId, role })

const rel = (
  id: string,
  aId: string,
  bId: string,
  kind: string | null,
  inverseKind: string | null,
): CharacterRelationship => ({
  id,
  branchId: 'b1',
  aId,
  bId,
  kind,
  inverseKind,
  createdAt: 1,
  updatedAt: 1,
})

function sequentialIds(): (prefix: string) => string {
  let n = 0
  return (prefix) => {
    n += 1
    return `${prefix}_new${n}`
  }
}

const A = entity('char_a', 'character')
const B = entity('char_b', 'character', { nameCollisionFlag: 1 })

function merge(overrides: Partial<EntityMergeInput> = {}) {
  const canonical = overrides.canonical ?? A
  const loser = overrides.loser ?? B
  return entityMergeActions({
    branchId: 'b1',
    canonical,
    loser,
    fromLoser: [],
    tags: canonical.tags,
    keywords: canonical.keywords,
    branchEntities: [canonical, loser],
    awareness: [],
    involvements: [],
    relationships: [],
    tail: null,
    newId: sequentialIds(),
    ...overrides,
  })
}

const ofKind = <K extends PipelineAction['kind']>(actions: readonly PipelineAction[], kind: K) =>
  actions.filter((a): a is Extract<PipelineAction, { kind: K }> => a.kind === kind)

const deleteLoser = {
  kind: 'deleteEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id: 'char_b' },
}

describe('entityMergeActions — refusals', () => {
  it('throws for a pair it cannot merge', () => {
    expect(() => merge({ loser: A })).toThrow(/char_a merged into itself/)
    expect(() => merge({ loser: entity('loc_b', 'location') })).toThrow(
      /location merged into character/,
    )
    expect(() => merge({ loser: entity('char_b', 'character', { branchId: 'b2' }) })).toThrow(
      /not both on b1/,
    )
    expect(() => merge({ canonical: entity('char_a', 'character', { branchId: 'b2' }) })).toThrow(
      /not both on b1/,
    )
    expect(() => merge({ branchEntities: [A] })).toThrow(/not among the branch entities/)
    expect(() => merge({ branchEntities: [B] })).toThrow(/not among the branch entities/)
  })
})

describe('entityMergeActions — the canonical', () => {
  it('writes nothing to an unflagged canonical that keeps every value, and deletes the loser', () => {
    expect(merge({ loser: entity('char_b', 'character') }).actions).toStrictEqual([deleteLoser])
  })

  it('takes the chosen scalars that differ and clears a flagged canonical', () => {
    const canonical = entity('char_a', 'character', { nameCollisionFlag: 1, description: 'old' })
    const loser = entity('char_b', 'character', {
      description: 'a guardsman',
      priority: 40,
      status: 'retired',
    })
    const { actions } = merge({
      canonical,
      loser,
      fromLoser: ['name', 'description', 'priority'],
    })
    expect(actions[0]).toStrictEqual({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'char_a',
        patch: { description: 'a guardsman', priority: 40, nameCollisionFlag: 0 },
      },
    })
  })

  it('collapses keyword case variants and trims and de-duplicates tags', () => {
    const canonical = entity('char_a', 'character', {
      keywords: ['the courier'],
      tags: ['courier'],
    })
    const { actions } = merge({
      canonical,
      keywords: ['the courier', 'The Courier', ' Grey Wolf ', 'grey wolf'],
      tags: [' courier', 'courier', '', 'fugitive'],
    })
    expect(ofKind(actions, 'updateEntity')[0].payload.patch).toStrictEqual({
      keywords: ['the courier', 'Grey Wolf'],
      tags: ['courier', 'fugitive'],
    })
  })

  it('writes no keywords or tags that normalize to the canonical’s stored lists', () => {
    const canonical = entity('char_a', 'character', {
      keywords: ['The Courier'],
      tags: ['courier'],
    })
    const { actions } = merge({
      canonical,
      loser: entity('char_b', 'character'),
      keywords: ['The Courier', 'the courier'],
      tags: ['courier', ' courier '],
    })
    expect(actions).toStrictEqual([deleteLoser])
  })

  it('writes a stored list back normalized when it was not', () => {
    const canonical = entity('char_a', 'character', {
      keywords: ['the courier', 'The Courier'],
      tags: [' courier'],
    })
    const { actions } = merge({
      canonical,
      loser: entity('char_b', 'character'),
      keywords: canonical.keywords,
      tags: canonical.tags,
    })
    expect(ofKind(actions, 'updateEntity')[0].payload.patch).toStrictEqual({
      tags: ['courier'],
      keywords: ['the courier'],
    })
  })
})

describe('entityMergeActions — inverse refs', () => {
  it('points every other entity at the canonical, one update each', () => {
    const hollow = entity('loc_a', 'location')
    const twin = entity('loc_b', 'location')
    const walker = entity('char_1', 'character', {}, { current_location_id: 'loc_b' })
    const key = entity('item_1', 'item', {}, { at_location_id: 'loc_b' })
    const cellar = entity('loc_c', 'location', {}, { parent_location_id: 'loc_b' })
    const elsewhere = entity('char_2', 'character', {}, { current_location_id: 'loc_9' })
    const { actions } = merge({
      canonical: hollow,
      loser: twin,
      branchEntities: [hollow, twin, walker, key, cellar, elsewhere],
    })
    expect(
      ofKind(actions, 'updateEntity').map((a) => [a.payload.id, a.payload.patch]),
    ).toStrictEqual([
      ['char_1', { state: { ...emptyEntityState('character'), current_location_id: 'loc_a' } }],
      ['item_1', { state: { at_location_id: 'loc_a' } }],
      ['loc_c', { state: { parent_location_id: 'loc_a' } }],
    ])
  })

  it('rewrites a holder’s equipped and inventory refs in one update, holding the item once', () => {
    const blade = entity('item_a', 'item')
    const twin = entity('item_b', 'item')
    const holder = entity(
      'char_1',
      'character',
      {},
      { equipped_items: ['item_b'], inventory: ['item_x', 'item_b'] },
    )
    const { actions, ...plan } = merge({
      canonical: blade,
      loser: twin,
      branchEntities: [blade, twin, holder],
    })
    const updates = ofKind(actions, 'updateEntity')
    expect(updates).toHaveLength(1)
    expect(updates[0].payload.patch.state).toMatchObject({
      equipped_items: ['item_a'],
      inventory: ['item_x'],
    })
    expect(plan.dropped.holdersLosingItem).toBe(0)
  })

  it('takes the loser off its holders when the canonical item is already held or placed', () => {
    const twin = entity('item_b', 'item')
    const holder = entity('char_1', 'character', {}, { inventory: ['item_b', 'item_x'] })
    const keeper = entity('char_2', 'character', {}, { equipped_items: ['item_a'] })
    const held = entity('item_a', 'item')
    const placed = entity('item_a', 'item', {}, { at_location_id: 'loc_1' })
    const dropped = { state: { ...emptyEntityState('character'), inventory: ['item_x'] } }

    const whileHeld = merge({
      canonical: held,
      loser: twin,
      branchEntities: [held, twin, holder, keeper],
    })
    expect(
      ofKind(whileHeld.actions, 'updateEntity').map((a) => [a.payload.id, a.payload.patch]),
    ).toStrictEqual([['char_1', dropped]])
    expect(whileHeld.dropped.holdersLosingItem).toBe(1)

    const whilePlaced = merge({
      canonical: placed,
      loser: twin,
      branchEntities: [placed, twin, holder],
    })
    expect(
      ofKind(whilePlaced.actions, 'updateEntity').map((a) => [a.payload.id, a.payload.patch]),
    ).toStrictEqual([['char_1', dropped]])
    expect(whilePlaced.dropped.holdersLosingItem).toBe(1)
  })

  it('counts no holder as losing the item when it carries both copies', () => {
    const placed = entity('item_a', 'item', {}, { at_location_id: 'loc_1' })
    const twin = entity('item_b', 'item')
    const both = entity('char_1', 'character', {}, { inventory: ['item_b', 'item_a'] })
    const onlyTwin = entity('char_2', 'character', {}, { equipped_items: ['item_b'] })
    const plan = merge({
      canonical: placed,
      loser: twin,
      branchEntities: [placed, twin, both, onlyTwin],
    })
    // Both are rewritten, but char_1 still carries the merged item.
    expect(ofKind(plan.actions, 'updateEntity').map((a) => a.payload.id)).toStrictEqual([
      'char_1',
      'char_2',
    ])
    expect(plan.dropped.holdersLosingItem).toBe(1)
  })

  it('gives a canonical item with no position the loser’s placement', () => {
    const lantern = entity('item_a', 'item')
    const placedTwin = entity('item_b', 'item', {}, { at_location_id: 'loc_1' })
    const adopted = merge({
      canonical: lantern,
      loser: placedTwin,
      branchEntities: [lantern, placedTwin],
    })
    const updates = ofKind(adopted.actions, 'updateEntity')
    expect(updates.map((a) => a.payload.id)).toStrictEqual(['item_a'])
    expect(updates[0].payload.patch.state).toMatchObject({ at_location_id: 'loc_1' })

    // Already placed: the canonical keeps its own position and takes nothing.
    const placed = entity('item_a', 'item', {}, { at_location_id: 'loc_2' })
    const kept = merge({
      canonical: placed,
      loser: placedTwin,
      branchEntities: [placed, placedTwin],
    })
    expect(ofKind(kept.actions, 'updateEntity')).toStrictEqual([])
  })

  it('nulls the canonical’s parent when it was the loser', () => {
    const cellar = entity('loc_a', 'location', {}, { parent_location_id: 'loc_b' })
    const hall = entity('loc_b', 'location')
    const { actions } = merge({ canonical: cellar, loser: hall, branchEntities: [cellar, hall] })
    expect(actions).toHaveLength(2)
    expect(actions[0]).toStrictEqual({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'loc_a', patch: { state: { parent_location_id: null } } },
    })
  })
})

describe('entityMergeActions — link rows', () => {
  it('moves the loser’s awareness with its fields and count, dropping one the canonical has', () => {
    const plan = merge({
      awareness: [
        aware('haw_1', 'char_a', 'hap_1'),
        aware('haw_2', 'char_b', 'hap_1', { source: 'told' }),
        aware('haw_3', 'char_b', 'hap_2', {
          learnedAtEntryId: 'entry_3',
          decayResistance: 0.5,
          source: 'witnessed',
          retrievalCount: 7,
        }),
        aware('haw_4', 'char_m', 'hap_3'),
      ],
    })
    expect(ofKind(plan.actions, 'upsertHappeningAwareness')).toStrictEqual([
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          characterId: 'char_a',
          happeningId: 'hap_2',
          learnedAtEntryId: 'entry_3',
          decayResistance: 0.5,
          source: 'witnessed',
          retrievalCount: 7,
        },
      },
    ])
    expect(plan.dropped.awareness).toBe(1)
  })

  it('re-creates an involvement under an injected id, dropping one in a happening the canonical is in', () => {
    const plan = merge({
      involvements: [
        involved('hinv_1', 'char_a', 'hap_1', 'witness'),
        involved('hinv_2', 'char_b', 'hap_1', 'culprit'),
        involved('hinv_3', 'char_b', 'hap_2', 'victim'),
      ],
    })
    expect(ofKind(plan.actions, 'createHappeningInvolvement')).toStrictEqual([
      {
        kind: 'createHappeningInvolvement',
        source: 'user_edit',
        payload: {
          entry: {
            id: 'hinv_new1',
            branchId: 'b1',
            happeningId: 'hap_2',
            entityId: 'char_a',
            role: 'victim',
          },
        },
      },
    ])
    expect(plan.dropped.involvements).toBe(1)
  })

  it('drops the relationship between the pair', () => {
    const plan = merge({ relationships: [rel('rel_1', 'char_a', 'char_b', 'twin', 'twin')] })
    expect(ofKind(plan.actions, 'upsertCharacterRelationship')).toStrictEqual([])
    expect(plan.dropped.relationships).toBe(0)
  })

  it('carries each view to the right side when the a/b order flips', () => {
    const canonical = entity('char_z', 'character')
    const plan = merge({
      canonical,
      branchEntities: [canonical, B],
      relationships: [
        rel('rel_1', 'char_b', 'char_m', 'mentor', 'pupil'),
        rel('rel_2', 'char_a', 'char_b', 'ally', 'rival'),
      ],
    })
    expect(ofKind(plan.actions, 'upsertCharacterRelationship').map((a) => a.payload)).toStrictEqual(
      [
        {
          branchId: 'b1',
          subjectId: 'char_z',
          objectId: 'char_m',
          kind: 'mentor',
          inverseKind: 'pupil',
        },
        {
          branchId: 'b1',
          subjectId: 'char_z',
          objectId: 'char_a',
          kind: 'rival',
          inverseKind: 'ally',
        },
      ],
    )
  })

  it('merges a pair both rows have, the canonical’s non-null views winning', () => {
    const plan = merge({
      relationships: [
        rel('rel_1', 'char_a', 'char_m', 'friend', null),
        rel('rel_2', 'char_b', 'char_m', 'enemy', 'debtor'),
      ],
    })
    expect(ofKind(plan.actions, 'upsertCharacterRelationship').map((a) => a.payload)).toStrictEqual(
      [
        {
          branchId: 'b1',
          subjectId: 'char_a',
          objectId: 'char_m',
          kind: 'friend',
          inverseKind: 'debtor',
        },
      ],
    )
    expect(plan.dropped.relationships).toBe(1)
  })

  it('writes no relationship when the canonical’s views already cover the pair', () => {
    const plan = merge({
      relationships: [
        rel('rel_1', 'char_a', 'char_m', 'friend', 'ally'),
        rel('rel_2', 'char_b', 'char_m', 'enemy', 'rival'),
      ],
    })
    expect(ofKind(plan.actions, 'upsertCharacterRelationship')).toStrictEqual([])
    expect(plan.dropped.relationships).toBe(1)
  })

  it('counts only the loser’s relationships whose other end the canonical already has', () => {
    const plan = merge({
      relationships: [
        rel('rel_1', 'char_a', 'char_m', 'friend', null),
        rel('rel_2', 'char_b', 'char_m', 'enemy', null),
        rel('rel_3', 'char_b', 'char_n', 'mentor', null),
        rel('rel_4', 'char_a', 'char_b', 'twin', 'twin'),
      ],
    })
    expect(plan.dropped.relationships).toBe(1)
    expect(ofKind(plan.actions, 'upsertCharacterRelationship')).toHaveLength(1)
  })
})

describe('entityMergeActions — tail scene', () => {
  it('puts the canonical where the loser stood in the scene', () => {
    const plan = merge({
      tail: { id: 'entry_9', sceneEntities: ['char_m', 'char_b'], currentLocationId: 'loc_1' },
    })
    expect(ofKind(plan.actions, 'updateStoryEntryMetadata')).toStrictEqual([
      {
        kind: 'updateStoryEntryMetadata',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'entry_9',
          metadata: { sceneEntities: ['char_m', 'char_a'] },
        },
      },
    ])
  })

  it('drops the loser from a scene the canonical is already in', () => {
    const plan = merge({
      tail: { id: 'entry_9', sceneEntities: ['char_a', 'char_b'], currentLocationId: null },
    })
    expect(ofKind(plan.actions, 'updateStoryEntryMetadata')[0].payload.metadata).toStrictEqual({
      sceneEntities: ['char_a'],
    })
  })

  it('makes the canonical the current location', () => {
    const hollow = entity('loc_a', 'location')
    const twin = entity('loc_b', 'location')
    const plan = merge({
      canonical: hollow,
      loser: twin,
      branchEntities: [hollow, twin],
      tail: { id: 'entry_9', sceneEntities: ['char_m'], currentLocationId: 'loc_b' },
    })
    expect(ofKind(plan.actions, 'updateStoryEntryMetadata')[0].payload.metadata).toStrictEqual({
      currentLocationId: 'loc_a',
    })
  })

  it('writes no tail action when the tail never named the loser', () => {
    const plan = merge({
      tail: { id: 'entry_9', sceneEntities: ['char_a'], currentLocationId: null },
    })
    expect(ofKind(plan.actions, 'updateStoryEntryMetadata')).toStrictEqual([])
  })
})

describe('entityMergeActions — the group', () => {
  it('orders canonical, refs, awareness, involvements, relationships, tail, delete, all user edits', () => {
    const walker = entity('char_w', 'character', {}, { faction_id: 'fac_x' })
    const factionA = entity('fac_a', 'faction', { nameCollisionFlag: 1 })
    const factionB = entity('fac_b', 'faction')
    const member = entity('char_1', 'character', {}, { faction_id: 'fac_b' })
    const factions = merge({
      canonical: factionA,
      loser: factionB,
      branchEntities: [factionA, factionB, member, walker],
      involvements: [involved('hinv_1', 'fac_b', 'hap_1', null)],
      tail: { id: 'entry_9', sceneEntities: ['fac_b'], currentLocationId: null },
    })
    const label = (a: PipelineAction) =>
      a.kind === 'updateEntity' ? `updateEntity:${a.payload.id}` : a.kind
    expect(factions.actions.map(label)).toStrictEqual([
      'updateEntity:fac_a',
      'updateEntity:char_1',
      'createHappeningInvolvement',
      'updateStoryEntryMetadata',
      'deleteEntity',
    ])

    const characters = merge({
      canonical: entity('char_a', 'character', { nameCollisionFlag: 1 }),
      awareness: [aware('haw_1', 'char_b', 'hap_1')],
      involvements: [involved('hinv_1', 'char_b', 'hap_1', null)],
      relationships: [rel('rel_1', 'char_b', 'char_m', 'friend', null)],
      tail: { id: 'entry_9', sceneEntities: ['char_b'], currentLocationId: null },
    })
    expect(characters.actions.map(label)).toStrictEqual([
      'updateEntity:char_a',
      'upsertHappeningAwareness',
      'createHappeningInvolvement',
      'upsertCharacterRelationship',
      'updateStoryEntryMetadata',
      'deleteEntity',
    ])
    expect(
      [...factions.actions, ...characters.actions].every((a) => a.source === 'user_edit'),
    ).toBe(true)
  })
})
