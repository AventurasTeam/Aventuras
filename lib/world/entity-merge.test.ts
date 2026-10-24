import { describe, expect, it } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import {
  emptyEntityState,
  type CharacterRelationship,
  type CollisionReason,
  type Entity,
  type EntityKind,
  type EntityState,
  type HappeningAwareness,
  type HappeningInvolvement,
} from '@/lib/db'

import { FLAG_CLEAR } from './collision-flags'
import { collisionPairOf, flaggedSideOf, type CollisionPair } from './collision-pair'
import { entityMergeActions, type EntityMergeInput } from './entity-merge'
import { referencingEntities } from './entity-refs'
import { mergeLinks } from './merge-links'
import { mergePlaceRefusal, storyPlaceOf } from './place-rules'

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
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
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

const flaggedWith = (partnerId: string, reason: CollisionReason = 'distinct'): Partial<Entity> => ({
  nameCollisionFlag: 1,
  nameCollisionPartnerId: partnerId,
  nameCollisionReason: reason,
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
const B = entity('char_b', 'character', flaggedWith('char_a'))
// Bystanders the link rows name.
const M = entity('char_m', 'character', { name: 'Mira' })
const N = entity('char_n', 'character', { name: 'Nell' })

/**
 * The pair `collisionPairOf` mints: when neither flag names the other, the second is flagged
 * with the first as partner, since these tests don't care about the rows' own flags.
 */
function pairOf(first: Entity, second: Entity): CollisionPair {
  const paired =
    flaggedSideOf(first, second) == null ? { ...second, ...flaggedWith(first.id) } : second
  const lookup = collisionPairOf([first, paired], [first.id, paired.id])
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
    story: storyPlaceOf({ tail: null, sceneSource: null }),
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
        story: storyPlaceOf({ tail: null, sceneSource: null }),
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
      story: storyPlaceOf({ tail: null, sceneSource: null }),
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
    const canonical = entity('char_a', 'character', {
      ...flaggedWith('char_b'),
      description: 'old',
    })
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
        patch: { description: 'a guardsman', priority: 40, ...FLAG_CLEAR },
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

describe('entityMergeActions — collision flags', () => {
  const updateOf = (id: string, patch: Record<string, unknown>) => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id, patch },
  })

  it('clears a flagged canonical whose partner is gone from the branch', () => {
    const canonical = entity('char_a', 'character', flaggedWith('char_gone'))
    expect(merge({ canonical, branchEntities: [canonical, B] }).actions).toStrictEqual([
      updateOf('char_a', FLAG_CLEAR),
      deleteLoser,
    ])
  })

  it("keeps the canonical's flag on a live third row while the merged row still matches it", () => {
    const third = entity('char_t', 'character')
    const canonical = entity('char_a', 'character', flaggedWith('char_t'))
    const loser = entity('char_b', 'character', {
      name: 'Brannoc',
      keywords: ['Kael'],
      ...flaggedWith('char_a'),
    })
    const branchEntities = [canonical, loser, third]
    const kept = merge({ canonical, loser, branchEntities, fromLoser: ['name'] })
    expect(kept.actions).toStrictEqual([
      updateOf('char_a', { name: 'Brannoc', keywords: ['Kael'] }),
      deleteLoser,
    ])

    const dropped = merge({
      canonical,
      loser,
      branchEntities,
      fromLoser: ['name'],
      deselectedKeywords: ['kael'],
    })
    expect(dropped.actions).toStrictEqual([
      updateOf('char_a', { name: 'Brannoc', ...FLAG_CLEAR }),
      deleteLoser,
    ])
  })

  it('re-points a flag on the loser at the canonical and clears flags the merged row breaks', () => {
    // Mira and Nell don't match the row they name: a keyword-only edit can leave a flag so.
    const onLoser = entity('char_r', 'character', flaggedWith('char_b'))
    const onCanonical = entity('char_s', 'character', flaggedWith('char_a'))
    const staleOnLoser = entity('char_u', 'character', { name: 'Mira', ...flaggedWith('char_b') })
    const staleOnCanonical = entity('char_v', 'character', {
      name: 'Nell',
      ...flaggedWith('char_a'),
    })
    const onThird = entity('char_w', 'character', { name: 'Mira', ...flaggedWith('char_m') })
    const { actions } = merge({
      branchEntities: [A, B, onLoser, onCanonical, staleOnLoser, staleOnCanonical, onThird, M],
    })
    expect(actions).toStrictEqual([
      updateOf('char_r', { nameCollisionPartnerId: 'char_a' }),
      updateOf('char_u', FLAG_CLEAR),
      updateOf('char_v', FLAG_CLEAR),
      deleteLoser,
    ])
  })

  it('writes no flag to the loser, even one the merged row stops matching', () => {
    const canonical = entity('char_a', 'character', { keywords: ['Brannoc'] })
    const loser = entity('char_b', 'character', { name: 'Brannoc', ...flaggedWith('char_a') })
    const { actions } = merge({
      canonical,
      loser,
      branchEntities: [canonical, loser],
      deselectedKeywords: ['brannoc'],
    })
    expect(actions).toStrictEqual([updateOf('char_a', { keywords: [] }), deleteLoser])
  })

  it('folds a re-point into the state patch of a row that held a ref to the loser', () => {
    const hollow = entity('loc_a', 'location')
    const twin = entity('loc_b', 'location', flaggedWith('loc_a'))
    const cellar = entity('loc_c', 'location', flaggedWith('loc_b'), {
      parent_location_id: 'loc_b',
    })
    const { actions } = merge({
      canonical: hollow,
      loser: twin,
      branchEntities: [hollow, twin, cellar],
    })
    expect(ofKind(actions, 'updateEntity')).toStrictEqual([
      updateOf('loc_c', {
        state: { parent_location_id: 'loc_a' },
        nameCollisionPartnerId: 'loc_a',
      }),
    ])
  })

  describe("the canonical inherits the loser's question", () => {
    const canonical = entity('char_a', 'character', flaggedWith('char_b'))
    const loserNaming = (partnerId: string) =>
      entity('char_b', 'character', flaggedWith(partnerId, 'in-scene'))
    const third = entity('char_t', 'character')

    it("re-points the canonical's flag at the loser's partner while the merged row matches it", () => {
      expect(
        merge({
          canonical,
          loser: loserNaming('char_t'),
          branchEntities: [canonical, loserNaming('char_t'), third],
        }).actions,
      ).toStrictEqual([
        updateOf('char_a', { nameCollisionPartnerId: 'char_t', nameCollisionReason: 'in-scene' }),
        deleteLoser,
      ])
    })

    it("judges the loser's partner against the merged row, not the canonical before it", () => {
      const brannoc = entity('char_a', 'character', { name: 'Brannoc', ...flaggedWith('char_b') })
      const loser = loserNaming('char_t')
      const { actions } = merge({
        canonical: brannoc,
        loser,
        branchEntities: [brannoc, loser, third],
        fromLoser: ['name'],
      })
      expect(actions).toStrictEqual([
        updateOf('char_a', {
          name: 'Kael',
          keywords: ['Brannoc'],
          nameCollisionPartnerId: 'char_t',
          nameCollisionReason: 'in-scene',
        }),
        deleteLoser,
      ])
    })

    it("clears it when the loser's partner is no namesake of the merged row", () => {
      const mira = entity('char_t', 'character', { name: 'Mira' })
      expect(
        merge({
          canonical,
          loser: loserNaming('char_t'),
          branchEntities: [canonical, loserNaming('char_t'), mira],
        }).actions,
      ).toStrictEqual([updateOf('char_a', FLAG_CLEAR), deleteLoser])
    })

    it("clears it when the loser's partner is gone from the branch", () => {
      expect(
        merge({
          canonical,
          loser: loserNaming('char_gone'),
          branchEntities: [canonical, loserNaming('char_gone'), third],
        }).actions,
      ).toStrictEqual([updateOf('char_a', FLAG_CLEAR), deleteLoser])
    })

    it('clears it when the loser names the canonical', () => {
      expect(
        merge({
          canonical,
          loser: loserNaming('char_a'),
          branchEntities: [canonical, loserNaming('char_a'), third],
        }).actions,
      ).toStrictEqual([updateOf('char_a', FLAG_CLEAR), deleteLoser])
    })

    it('clears it when the loser is unflagged', () => {
      const loser = entity('char_b', 'character')
      expect(
        merge({ canonical, loser, branchEntities: [canonical, loser, third] }).actions,
      ).toStrictEqual([updateOf('char_a', FLAG_CLEAR), deleteLoser])
    })
  })

  it("clears instead of re-pointing once the merge drops the loser's name", () => {
    const canonical = entity('char_a', 'character')
    const loser = entity('char_b', 'character', {
      name: 'Brannoc',
      keywords: ['Kael'],
      ...flaggedWith('char_a'),
    })
    const namesake = entity('char_r', 'character', { name: 'Brannoc', ...flaggedWith('char_b') })
    const branchEntities = [canonical, loser, namesake]

    const kept = merge({ canonical, loser, branchEntities })
    expect(ofKind(kept.actions, 'updateEntity')).toStrictEqual([
      updateOf('char_a', { keywords: ['Brannoc', 'Kael'] }),
      updateOf('char_r', { nameCollisionPartnerId: 'char_a' }),
    ])

    const dropped = merge({ canonical, loser, branchEntities, deselectedKeywords: ['brannoc'] })
    expect(ofKind(dropped.actions, 'updateEntity')).toStrictEqual([
      updateOf('char_a', { keywords: ['Kael'] }),
      updateOf('char_r', FLAG_CLEAR),
    ])
  })

  describe("a place's parent after the merge", () => {
    const place = (
      id: string,
      name: string,
      parentId: string | null,
      overrides: Partial<Entity> = {},
    ): Entity => entity(id, 'location', { name, ...overrides }, { parent_location_id: parentId })
    const deleteOf = (id: string) => ({
      kind: 'deleteEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id },
    })
    const hollow = place('loc_p', 'Veil’s Hollow', null)
    const quay = place('loc_q', 'The Quay', null)

    it('clears a same-parent flag on the loser once the canonical sits under another parent', () => {
      const stalls = place(
        'loc_s',
        'The Market Stalls',
        'loc_p',
        flaggedWith('loc_b', 'same-parent'),
      )
      const canonical = place('loc_a', 'The Market', 'loc_q')
      const loser = place('loc_b', 'The Market', 'loc_p', flaggedWith('loc_a'))
      expect(
        merge({ canonical, loser, branchEntities: [hollow, quay, canonical, loser, stalls] })
          .actions,
      ).toStrictEqual([updateOf('loc_s', FLAG_CLEAR), deleteOf('loc_b')])

      // A canonical under the loser's parent still shares the sibling's: the flag re-points.
      const sibling = place('loc_a', 'The Market', 'loc_p')
      const twin = place('loc_b', 'The Market', 'loc_p', flaggedWith('loc_a', 'same-parent'))
      expect(
        merge({ canonical: sibling, loser: twin, branchEntities: [hollow, sibling, twin, stalls] })
          .actions,
      ).toStrictEqual([updateOf('loc_s', { nameCollisionPartnerId: 'loc_a' }), deleteOf('loc_b')])
    })

    it("clears the canonical's same-parent flag on a former sibling once it leaves the loser", () => {
      const inn = place('loc_b', 'The Old Inn', null)
      const cellar = place(
        'loc_a',
        'The Old Inn Cellar',
        'loc_b',
        flaggedWith('loc_s', 'same-parent'),
      )
      const storeroom = place('loc_s', 'Inn Cellar', 'loc_b')
      // The merge also keeps the name it drops as a keyword (world.md → Merge).
      expect(
        merge({ canonical: cellar, loser: inn, branchEntities: [inn, cellar, storeroom] }).actions,
      ).toStrictEqual([
        updateOf('loc_a', {
          keywords: ['The Old Inn'],
          state: { parent_location_id: null, unplaced: true },
          ...FLAG_CLEAR,
        }),
        updateOf('loc_s', { state: { parent_location_id: 'loc_a' } }),
        deleteOf('loc_b'),
      ])

      // The same flag under a parent the merge leaves alone stays.
      const housed = place(
        'loc_a',
        'The Old Inn Cellar',
        'loc_p',
        flaggedWith('loc_s', 'same-parent'),
      )
      const neighbour = place('loc_s', 'Inn Cellar', 'loc_p')
      expect(
        merge({ canonical: housed, loser: inn, branchEntities: [hollow, inn, housed, neighbour] })
          .actions,
      ).toStrictEqual([updateOf('loc_a', { keywords: ['The Old Inn'] }), deleteOf('loc_b')])
    })

    it('keeps a same-parent pair under the loser: both rows move to the canonical', () => {
      const canonical = place('loc_a', 'The Hollow', null)
      const loser = place('loc_b', 'The Hollow', null, flaggedWith('loc_a', 'same-parent'))
      const inn = place('loc_i', 'The Inn', 'loc_b')
      const yard = place('loc_j', 'The Inn Yard', 'loc_b', flaggedWith('loc_i', 'same-parent'))
      expect(
        merge({ canonical, loser, branchEntities: [canonical, loser, inn, yard] }).actions,
      ).toStrictEqual([
        updateOf('loc_i', { state: { parent_location_id: 'loc_a' } }),
        updateOf('loc_j', { state: { parent_location_id: 'loc_a' } }),
        deleteOf('loc_b'),
      ])
    })

    it('leaves a canonical under the loser unplaced, which no longer pairs with the root siblings', () => {
      const loser = place('loc_b', 'The Market', null, flaggedWith('loc_s', 'same-parent'))
      const canonical = place('loc_a', 'The Market', 'loc_b', flaggedWith('loc_b'))
      const stalls = place('loc_s', 'The Market Stalls', null)
      expect(
        merge({ canonical, loser, branchEntities: [canonical, loser, stalls] }).actions,
      ).toStrictEqual([
        updateOf('loc_a', {
          state: { parent_location_id: null, unplaced: true },
          ...FLAG_CLEAR,
        }),
        deleteOf('loc_b'),
      ])

      const plainLoser = place('loc_b', 'The Market', null)
      const under = place('loc_a', 'The Market', 'loc_b')
      const rootStalls = place(
        'loc_s',
        'The Market Stalls',
        null,
        flaggedWith('loc_b', 'same-parent'),
      )
      expect(
        merge({
          canonical: under,
          loser: plainLoser,
          branchEntities: [under, plainLoser, rootStalls],
        }).actions,
      ).toStrictEqual([
        updateOf('loc_a', { state: { parent_location_id: null, unplaced: true } }),
        updateOf('loc_s', FLAG_CLEAR),
        deleteOf('loc_b'),
      ])
    })

    it("takes the loser's same-parent partner only while the canonical shares its parent", () => {
      const sibling = place('loc_s', 'The Market Stalls', 'loc_p')
      const loser = place('loc_b', 'The Market', 'loc_p', flaggedWith('loc_s', 'same-parent'))
      const across = place('loc_a', 'The Market', 'loc_q', flaggedWith('loc_b'))
      expect(
        merge({ canonical: across, loser, branchEntities: [hollow, quay, across, loser, sibling] })
          .actions,
      ).toStrictEqual([updateOf('loc_a', FLAG_CLEAR), deleteOf('loc_b')])

      const beside = place('loc_a', 'The Market', 'loc_p', flaggedWith('loc_b'))
      expect(
        merge({ canonical: beside, loser, branchEntities: [hollow, beside, loser, sibling] })
          .actions,
      ).toStrictEqual([
        updateOf('loc_a', { nameCollisionPartnerId: 'loc_s', nameCollisionReason: 'same-parent' }),
        deleteOf('loc_b'),
      ])
    })

    const unplaced = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
      entity(id, 'location', { name, ...overrides }, { parent_location_id: null, unplaced: true })

    it('places an unplaced canonical where the loser sat, and says so', () => {
      const varn = unplaced('loc_a', 'Varn')
      const twin = place('loc_b', 'Varn', 'loc_p')
      const placed = merge({ canonical: varn, loser: twin, branchEntities: [hollow, varn, twin] })
      expect(placed.actions).toStrictEqual([
        updateOf('loc_a', { state: { parent_location_id: 'loc_p' } }),
        deleteOf('loc_b'),
      ])
      expect(placed.overlap.canonicalPlacement).toBe('takes-loser')

      const topTwin = place('loc_b', 'Varn', null)
      const lifted = merge({ canonical: varn, loser: topTwin, branchEntities: [varn, topTwin] })
      expect(lifted.actions).toStrictEqual([
        updateOf('loc_a', { state: { parent_location_id: null } }),
        deleteOf('loc_b'),
      ])
      expect(lifted.overlap.canonicalPlacement).toBe('takes-loser')
    })

    it('keeps an unplaced canonical unplaced when the loser’s place is retired, unknown or inside it', () => {
      const varn = unplaced('loc_a', 'Varn')
      const retired = place('loc_p', 'Veil’s Hollow', null, { status: 'retired' })
      const underRetired = place('loc_b', 'Varn', 'loc_p')
      const keptFromRetired = merge({
        canonical: varn,
        loser: underRetired,
        branchEntities: [retired, varn, underRetired],
      })
      expect(keptFromRetired.actions).toStrictEqual([deleteOf('loc_b')])
      expect(keptFromRetired.overlap.canonicalPlacement).toBe('stays-unplaced')

      const unknownTwin = unplaced('loc_b', 'Varn')
      const keptUnknown = merge({
        canonical: varn,
        loser: unknownTwin,
        branchEntities: [varn, unknownTwin],
      })
      expect(keptUnknown.actions).toStrictEqual([deleteOf('loc_b')])
      expect(keptUnknown.overlap.canonicalPlacement).toBe('stays-unplaced')

      // The loser sits in a place inside the canonical: taking its parent would close a loop.
      const quarter = place('loc_q', 'The Old Quarter', 'loc_a')
      const inside = place('loc_b', 'Varn', 'loc_q')
      const keptFromLoop = merge({
        canonical: varn,
        loser: inside,
        branchEntities: [varn, quarter, inside],
      })
      expect(keptFromLoop.actions).toStrictEqual([deleteOf('loc_b')])
      expect(keptFromLoop.overlap.canonicalPlacement).toBe('stays-unplaced')
    })

    describe('under a disabled place', () => {
      const storyAt = (id: string) =>
        storyPlaceOf({
          tail: { metadata: { currentLocationId: id } },
          sceneSource: { metadata: { currentLocationId: id } },
        })
      const dark = place('loc_d', 'The Dark Wing', null, { injectionMode: 'disabled' })
      const inDark = place('loc_b', 'Varn', 'loc_d')

      it('keeps an unplaced canonical that holds the story unplaced', () => {
        const varn = unplaced('loc_a', 'Varn')
        const cellar = place('loc_c', 'The Cellar', 'loc_a')
        for (const at of ['loc_a', 'loc_c']) {
          const kept = merge({
            canonical: varn,
            loser: inDark,
            branchEntities: [dark, varn, cellar, inDark],
            story: storyAt(at),
          })
          expect(kept.actions).toStrictEqual([deleteOf('loc_b')])
          expect(kept.overlap.canonicalPlacement).toBe('stays-unplaced')
        }
      })

      it('keeps it unplaced when only an ancestor of the loser’s parent is disabled', () => {
        const varn = unplaced('loc_a', 'Varn')
        const wing = place('loc_e', 'The East Hall', 'loc_d')
        const deep = place('loc_b', 'Varn', 'loc_e')
        const kept = merge({
          canonical: varn,
          loser: deep,
          branchEntities: [dark, wing, varn, deep],
          story: storyAt('loc_a'),
        })
        expect(kept.overlap.canonicalPlacement).toBe('stays-unplaced')
      })

      it('reads the scene as well as the tail', () => {
        const varn = unplaced('loc_a', 'Varn')
        const kept = merge({
          canonical: varn,
          loser: inDark,
          branchEntities: [hollow, dark, varn, inDark],
          story: storyPlaceOf({
            tail: { metadata: { currentLocationId: 'loc_p' } },
            sceneSource: { metadata: { currentLocationId: 'loc_a' } },
          }),
        })
        expect(kept.overlap.canonicalPlacement).toBe('stays-unplaced')
      })

      // The footnote never sees fromLoser, so the adoption is judged apart from the merged mode.
      it('judges the adoption alone, whatever mode the merged place ends with', () => {
        const dim = unplaced('loc_a', 'Varn', { injectionMode: 'disabled' })
        const lit = place('loc_b', 'Varn', 'loc_p')
        const world = [hollow, dim, lit]
        const story = storyAt('loc_b')

        const takesMode = merge({
          canonical: dim,
          loser: lit,
          branchEntities: world,
          story,
          fromLoser: ['injectionMode'],
        })
        expect(takesMode.overlap.canonicalPlacement).toBe('takes-loser')
        expect(takesMode.actions).toStrictEqual([
          updateOf('loc_a', {
            injectionMode: 'auto',
            state: { parent_location_id: 'loc_p' },
          }),
          deleteOf('loc_b'),
        ])
        expect(
          mergePlaceRefusal({
            canonical: dim,
            loser: lit,
            actions: takesMode.actions,
            branchEntities: world,
            story,
          }),
        ).toBeNull()

        // Keeping its own disabled mode, the merge is refused for the mode, not the adoption.
        const keepsMode = merge({ canonical: dim, loser: lit, branchEntities: world, story })
        expect(keepsMode.overlap.canonicalPlacement).toBe('takes-loser')
        expect(
          mergePlaceRefusal({
            canonical: dim,
            loser: lit,
            actions: keepsMode.actions,
            branchEntities: world,
            story,
          }),
        ).toBe('story-inside')
      })

      it('still places the canonical when the story is elsewhere or already in the loser', () => {
        const varn = unplaced('loc_a', 'Varn')
        for (const at of ['loc_p', 'loc_b']) {
          const placed = merge({
            canonical: varn,
            loser: inDark,
            branchEntities: [hollow, dark, varn, inDark],
            story: storyAt(at),
          })
          expect(placed.actions).toStrictEqual([
            updateOf('loc_a', { state: { parent_location_id: 'loc_d' } }),
            deleteOf('loc_b'),
          ])
          expect(placed.overlap.canonicalPlacement).toBe('takes-loser')
        }
      })

      it('places a canonical the story is in when the disabled place is not above the loser', () => {
        const varn = unplaced('loc_a', 'Varn')
        const lit = place('loc_b', 'Varn', 'loc_p')
        const placed = merge({
          canonical: varn,
          loser: lit,
          branchEntities: [hollow, dark, varn, lit],
          story: storyAt('loc_a'),
        })
        expect(placed.overlap.canonicalPlacement).toBe('takes-loser')
      })
    })

    it('treats a canonical whose stored parent names no place as unplaced, and places it', () => {
      const canonical = place('loc_a', 'Varn', 'loc_gone')
      const twin = place('loc_b', 'Varn', 'loc_p')
      const plan = merge({ canonical, loser: twin, branchEntities: [hollow, canonical, twin] })
      expect(plan.actions).toStrictEqual([
        updateOf('loc_a', { state: { parent_location_id: 'loc_p' } }),
        deleteOf('loc_b'),
      ])
      expect(plan.overlap.canonicalPlacement).toBe('takes-loser')
    })

    it("keeps a same-parent pair on the loser once the canonical takes the loser's parent", () => {
      const canonical = unplaced('loc_a', 'The Market')
      const twin = place('loc_b', 'The Market', 'loc_p')
      const stalls = place(
        'loc_s',
        'The Market Stalls',
        'loc_p',
        flaggedWith('loc_b', 'same-parent'),
      )
      expect(
        merge({ canonical, loser: twin, branchEntities: [hollow, canonical, twin, stalls] })
          .actions,
      ).toStrictEqual([
        updateOf('loc_a', { state: { parent_location_id: 'loc_p' } }),
        updateOf('loc_s', { nameCollisionPartnerId: 'loc_a' }),
        deleteOf('loc_b'),
      ])
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

  it('unplaces the canonical when its parent was the loser, and counts the cleared ref', () => {
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
      payload: {
        branchId: 'b1',
        id: 'loc_a',
        patch: { state: { parent_location_id: null, unplaced: true } },
      },
    })
    expect(overlap.canonicalRefs).toBe(1)
    // Placed before the merge, so it takes nothing from the loser: no placement footnote.
    expect(overlap).not.toHaveProperty('canonicalPlacement')
    // The other way round the loser's own parent goes with it: nothing on the canonical clears.
    const reversed = merge({ canonical: hall, loser: cellar, branchEntities: [cellar, hall] })
    expect(reversed.overlap.canonicalRefs).toBe(0)
    expect(reversed.overlap).not.toHaveProperty('canonicalPlacement')
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
          proseEntryId: null,
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
    const factionA = entity('fac_a', 'faction', flaggedWith('fac_b'))
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
      canonical: entity('char_a', 'character', flaggedWith('char_b')),
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
