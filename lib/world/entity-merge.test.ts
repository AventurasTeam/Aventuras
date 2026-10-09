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

import { collisionPairOf, type CollisionPair } from './collision-pair'
import { entityMergeActions, type EntityMergeInput } from './entity-merge'
import { referencingEntities } from './entity-refs'
import { mergeLinks } from './merge-links'

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
// Bystanders the link rows name.
const M = entity('char_m', 'character', { name: 'Mira' })
const N = entity('char_n', 'character', { name: 'Nell' })

function pairOf(first: Entity, second: Entity): CollisionPair {
  const lookup = collisionPairOf([first, second], [first.id, second.id])
  if ('miss' in lookup) throw new Error(`not a collision pair: ${lookup.miss}`)
  return lookup.pair
}

type MergeOverrides = Partial<Omit<EntityMergeInput, 'pair' | 'canonicalId'>> & {
  canonical?: Entity
  loser?: Entity
}

/** The planner's actions, and what `mergeLinks` counts as giving way for the same input. */
function merge({ canonical = A, loser = B, ...overrides }: MergeOverrides = {}) {
  const input = {
    branchId: 'b1',
    fromLoser: [],
    deselectedTags: [],
    deselectedKeywords: [],
    branchEntities: [canonical, loser, M, N],
    happenings: ['hap_1', 'hap_2', 'hap_3'].map((id) => ({ id, branchId: 'b1' })),
    awareness: [],
    involvements: [],
    relationships: [],
    tail: null,
    newId: sequentialIds(),
    ...overrides,
  }
  return {
    actions: entityMergeActions({
      ...input,
      pair: pairOf(canonical, loser),
      canonicalId: canonical.id,
    }),
    overlap: mergeLinks({ ...input, canonical, loser }).overlap,
  }
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
    expect(() =>
      merge({
        canonical: entity('char_a', 'character', { branchId: 'b2' }),
        loser: entity('char_b', 'character', { branchId: 'b2' }),
      }),
    ).toThrow(/not both on b1/)
    expect(() => merge({ branchEntities: [A] })).toThrow(/not among the branch entities/)
    expect(() => merge({ branchEntities: [B] })).toThrow(/not among the branch entities/)
  })

  it('throws for a canonical id outside the pair', () => {
    expect(() =>
      entityMergeActions({
        branchId: 'b1',
        pair: pairOf(A, B),
        canonicalId: 'char_z',
        fromLoser: [],
        deselectedTags: [],
        deselectedKeywords: [],
        branchEntities: [A, B],
        happenings: [],
        awareness: [],
        involvements: [],
        relationships: [],
        tail: null,
        newId: sequentialIds(),
      }),
    ).toThrow(/char_z is not in the pair/)
  })

  it('merges into the second row of the pair as readily as the first', () => {
    const actions = entityMergeActions({
      branchId: 'b1',
      pair: pairOf(B, A),
      canonicalId: 'char_a',
      fromLoser: [],
      deselectedTags: [],
      deselectedKeywords: [],
      branchEntities: [A, B],
      happenings: [],
      awareness: [],
      involvements: [],
      relationships: [],
      tail: null,
      newId: sequentialIds(),
    })
    expect(actions).toStrictEqual([deleteLoser])
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

  it("unions the loser's terms after the canonical's, collapsing keyword case variants", () => {
    const canonical = entity('char_a', 'character', {
      keywords: ['the courier'],
      tags: ['courier'],
    })
    const loser = entity('char_b', 'character', {
      keywords: ['The Courier', ' Grey Wolf ', 'grey wolf'],
      tags: [' courier', 'courier', '', 'fugitive'],
    })
    const { actions } = merge({ canonical, loser })
    expect(ofKind(actions, 'updateEntity')[0].payload.patch).toStrictEqual({
      keywords: ['the courier', 'Grey Wolf'],
      tags: ['courier', 'fugitive'],
    })
  })

  it('drops the deselected terms of either row', () => {
    const canonical = entity('char_a', 'character', {
      keywords: ['the courier', 'the rider'],
      tags: ['courier', 'rider'],
    })
    const loser = entity('char_b', 'character', {
      keywords: ['Grey Wolf', 'the fugitive'],
      tags: ['fugitive', 'wolf'],
    })
    const { actions } = merge({
      canonical,
      loser,
      deselectedTags: ['rider', 'wolf'],
      deselectedKeywords: ['THE RIDER', 'grey wolf'],
    })
    expect(ofKind(actions, 'updateEntity')[0].payload.patch).toStrictEqual({
      keywords: ['the courier', 'the fugitive'],
      tags: ['courier', 'fugitive'],
    })
  })

  it('writes no keywords or tags that normalize to the canonical’s stored lists', () => {
    const canonical = entity('char_a', 'character', {
      keywords: ['The Courier'],
      tags: ['courier'],
    })
    const loser = entity('char_b', 'character', {
      keywords: ['the courier'],
      tags: [' courier '],
    })
    expect(merge({ canonical, loser }).actions).toStrictEqual([deleteLoser])
  })

  it('writes a stored list back normalized when it was not', () => {
    const canonical = entity('char_a', 'character', {
      keywords: ['the courier', 'The Courier'],
      tags: [' courier'],
    })
    const { actions } = merge({ canonical, loser: entity('char_b', 'character') })
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

  it('renames the place a character was last seen, and leaves a delete’s to history', () => {
    const hollow = entity('loc_a', 'location')
    const twin = entity('loc_b', 'location')
    const lastSeenAt = { entryId: 'ent_1', locationId: 'loc_b', worldTime: 60 }
    const left = entity('char_1', 'character', {}, { current_location_id: null, lastSeenAt })
    const { actions } = merge({
      canonical: hollow,
      loser: twin,
      branchEntities: [hollow, twin, left],
    })
    expect(
      ofKind(actions, 'updateEntity').map((a) => [a.payload.id, a.payload.patch]),
    ).toStrictEqual([
      [
        'char_1',
        {
          state: {
            ...emptyEntityState('character'),
            lastSeenAt: { ...lastSeenAt, locationId: 'loc_a' },
          },
        },
      ],
    ])
    expect(referencingEntities('loc_b', [hollow, twin, left])).toEqual([])
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
    expect(plan.overlap.holdersLosingItem).toBe(0)
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
    expect(whileHeld.overlap.holdersLosingItem).toBe(1)

    const whilePlaced = merge({
      canonical: placed,
      loser: twin,
      branchEntities: [placed, twin, holder],
    })
    expect(
      ofKind(whilePlaced.actions, 'updateEntity').map((a) => [a.payload.id, a.payload.patch]),
    ).toStrictEqual([['char_1', dropped]])
    expect(whilePlaced.overlap.holdersLosingItem).toBe(1)
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
    expect(plan.overlap.holdersLosingItem).toBe(1)
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

  it('nulls the canonical’s parent when it was the loser, and counts the cleared ref', () => {
    const cellar = entity('loc_a', 'location', {}, { parent_location_id: 'loc_b' })
    const hall = entity('loc_b', 'location')
    const { actions, overlap } = merge({
      canonical: cellar,
      loser: hall,
      branchEntities: [cellar, hall],
    })
    expect(actions).toHaveLength(2)
    expect(actions[0]).toStrictEqual({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'loc_a', patch: { state: { parent_location_id: null } } },
    })
    expect(overlap.canonicalRefs).toBe(1)
    // The other way round the loser's own parent goes with it: nothing on the canonical clears.
    const reversed = merge({ canonical: hall, loser: cellar, branchEntities: [cellar, hall] })
    expect(reversed.overlap.canonicalRefs).toBe(0)
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
    expect(plan.overlap.awareness).toBe(1)
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
    expect(plan.overlap.involvements).toBe(1)
  })

  it('moves one of the loser’s involvements per happening, the first with its role', () => {
    const plan = merge({
      involvements: [
        involved('hinv_1', 'char_b', 'hap_2', 'victim'),
        involved('hinv_2', 'char_b', 'hap_3', null),
        involved('hinv_3', 'char_b', 'hap_2', 'witness'),
      ],
    })
    expect(
      ofKind(plan.actions, 'createHappeningInvolvement').map((a) => [
        a.payload.entry.happeningId,
        a.payload.entry.role,
      ]),
    ).toStrictEqual([
      ['hap_2', 'victim'],
      ['hap_3', null],
    ])
    expect(plan.overlap.involvements).toBe(1)
  })

  it('copies a link row whose other end the branch has, and leaves one whose end is gone', () => {
    const plan = merge({
      branchEntities: [A, B, M, entity('char_g', 'character', { branchId: 'b2' })],
      // hap_g survives on another branch only.
      happenings: [
        { id: 'hap_1', branchId: 'b1' },
        { id: 'hap_g', branchId: 'b2' },
      ],
      awareness: [aware('haw_1', 'char_b', 'hap_1'), aware('haw_2', 'char_b', 'hap_g')],
      involvements: [
        involved('hinv_1', 'char_b', 'hap_g', null),
        involved('hinv_2', 'char_b', 'hap_1', 'witness'),
      ],
      relationships: [
        rel('rel_1', 'char_b', 'char_g', 'friend', null),
        rel('rel_2', 'char_b', 'char_m', 'mentor', null),
      ],
    })
    const ends = plan.actions.map((a) => {
      switch (a.kind) {
        case 'upsertHappeningAwareness':
          return `${a.kind}:${a.payload.happeningId}`
        case 'createHappeningInvolvement':
          return `${a.kind}:${a.payload.entry.happeningId}`
        case 'upsertCharacterRelationship':
          return `${a.kind}:${a.payload.objectId}`
        default:
          return a.kind
      }
    })
    expect(ends).toStrictEqual([
      'upsertHappeningAwareness:hap_1',
      'createHappeningInvolvement:hap_1',
      'upsertCharacterRelationship:char_m',
      'deleteEntity',
    ])
    expect(plan.overlap).toStrictEqual({
      awareness: 0,
      involvements: 0,
      relationships: 0,
      holdersLosingItem: 0,
      canonicalRefs: 0,
    })
  })

  it('drops the relationship between the pair', () => {
    const plan = merge({ relationships: [rel('rel_1', 'char_a', 'char_b', 'twin', 'twin')] })
    expect(ofKind(plan.actions, 'upsertCharacterRelationship')).toStrictEqual([])
    expect(plan.overlap.relationships).toBe(0)
  })

  it('carries each view to the right side when the a/b order flips', () => {
    const canonical = entity('char_z', 'character')
    const plan = merge({
      canonical,
      branchEntities: [canonical, B, A, M],
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
    expect(plan.overlap.relationships).toBe(1)
  })

  it('writes no relationship when the canonical’s views already cover the pair', () => {
    const plan = merge({
      relationships: [
        rel('rel_1', 'char_a', 'char_m', 'friend', 'ally'),
        rel('rel_2', 'char_b', 'char_m', 'enemy', 'rival'),
      ],
    })
    expect(ofKind(plan.actions, 'upsertCharacterRelationship')).toStrictEqual([])
    expect(plan.overlap.relationships).toBe(1)
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
    expect(plan.overlap.relationships).toBe(1)
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

describe('entityMergeActions — scene effects', () => {
  const tail = { id: 'entry_9', sceneEntities: ['char_b'], currentLocationId: 'loc_t' }
  const promote = {
    kind: 'promoteStagedEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id: 'char_a', proseEntryId: null },
  }
  const track = {
    kind: 'updateEntityLocationTracking',
    source: 'user_edit',
    payload: { branchId: 'b1', id: 'char_a', currentLocationId: 'loc_t' },
  }

  it('promotes a staged canonical it seats and tracks it to the tail, after the delete', () => {
    const canonical = entity('char_a', 'character', { status: 'staged' })
    const { actions } = merge({ canonical, branchEntities: [canonical, B], tail })
    expect(actions.slice(-3)).toStrictEqual([deleteLoser, promote, track])
    expect(ofKind(actions, 'updateEntity')).toStrictEqual([])
  })

  it('folds the promotion into a staged status the canonical takes from the loser', () => {
    const loser = entity('char_b', 'character', { status: 'staged' })
    const { actions } = merge({ loser, branchEntities: [A, loser], tail, fromLoser: ['status'] })
    expect(ofKind(actions, 'updateEntity')[0].payload.patch).toStrictEqual({ status: 'active' })
    expect(ofKind(actions, 'promoteStagedEntity')).toStrictEqual([])
  })

  it("folds the tail's location into a state patch the canonical already writes", () => {
    // No well-formed character merge writes the canonical's state: a ref to the loser forces one.
    const canonical = entity('char_a', 'character', {}, { faction_id: 'char_b' })
    const { actions } = merge({ canonical, branchEntities: [canonical, B], tail })
    expect(ofKind(actions, 'updateEntity')[0].payload.patch).toStrictEqual({
      state: { ...emptyEntityState('character'), current_location_id: 'loc_t' },
    })
    expect(ofKind(actions, 'updateEntityLocationTracking')).toStrictEqual([])
  })

  it('promotes a canonical the scene already held, but keeps its own location', () => {
    const canonical = entity('char_a', 'character', { status: 'staged' })
    const sharedTail = { ...tail, sceneEntities: ['char_a', 'char_b'] }
    const { actions } = merge({ canonical, branchEntities: [canonical, B], tail: sharedTail })
    expect(actions.slice(-2)).toStrictEqual([deleteLoser, promote])
    expect(ofKind(actions, 'updateEntityLocationTracking')).toStrictEqual([])

    const writing = entity('char_a', 'character', {}, { faction_id: 'char_b' })
    const folded = merge({ canonical: writing, branchEntities: [writing, B], tail: sharedTail })
    expect(ofKind(folded.actions, 'updateEntity')[0].payload.patch).toStrictEqual({
      state: emptyEntityState('character'),
    })
  })

  it('tracks nothing to a tail with no location, and seats nothing the tail never named', () => {
    const staged = entity('char_a', 'character', { status: 'staged' })
    const unlocated = merge({
      canonical: staged,
      branchEntities: [staged, B],
      tail: { ...tail, currentLocationId: null },
    })
    expect(unlocated.actions.slice(-2)).toStrictEqual([deleteLoser, promote])
    const elsewhere = merge({
      canonical: staged,
      branchEntities: [staged, B],
      tail: { ...tail, sceneEntities: ['char_m'] },
    })
    expect(elsewhere.actions).toStrictEqual([deleteLoser])
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
