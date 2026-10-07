import type { DatabaseSync } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  emptyEntityState,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  translations,
  type EntityKind,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  characterRelationshipsStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  translationsStore,
} from '@/lib/stores'
import { collisionPairOf, entityMergeActions } from '@/lib/world'

import { collisionPair, type CollisionSources } from './collision-summary'

let sqlite: DatabaseSync

function entity(
  id: string,
  kind: EntityKind,
  name: string,
  createdAt: number,
  state: Record<string, unknown> = {},
  extra: Partial<NewEntity> = {},
): NewEntity {
  return {
    id,
    branchId: 'b1',
    kind,
    name,
    status: 'active',
    injectionMode: 'auto',
    state: { ...emptyEntityState(kind), ...state } as NewEntity['state'],
    embeddingStale: 0,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  }
}

const translation = (
  id: string,
  targetKind: 'entity' | 'character_relationship',
  targetId: string,
) => ({
  id,
  branchId: 'b1',
  targetKind,
  targetId,
  field: 'name',
  language: 'cs',
  translatedText: 'x',
  createdAt: 1,
  updatedAt: 1,
})

const relationship = (id: string, aId: string, bId: string) => ({
  id,
  branchId: 'b1',
  aId,
  bId,
  kind: 'ally',
  inverseKind: null,
  createdAt: 1,
  updatedAt: 1,
})

const SQL = {
  awarenessRows:
    'SELECT count(*) AS n FROM happening_awareness WHERE branch_id = ?1 AND character_id = ?2',
  involvements:
    'SELECT count(*) AS n FROM happening_involvements WHERE branch_id = ?1 AND entity_id = ?2',
  // The pair's own relationship is dropped by the merge, not moved, so it isn't counted.
  relationships:
    'SELECT count(*) AS n FROM character_relationships WHERE branch_id = ?1 AND (a_id = ?2 OR b_id = ?2) AND NOT (a_id = ?3 OR b_id = ?3)',
  // Rows of this side whose other end the partner already relates to (the joining row excluded).
  overlapRelationships: `SELECT count(*) AS n FROM character_relationships r
    WHERE r.branch_id = ?1 AND (r.a_id = ?2 OR r.b_id = ?2) AND NOT (r.a_id = ?3 OR r.b_id = ?3)
      AND EXISTS (SELECT 1 FROM character_relationships p WHERE p.branch_id = ?1 AND (
        (p.a_id = ?3 AND p.b_id = CASE WHEN r.a_id = ?2 THEN r.b_id ELSE r.a_id END)
        OR (p.b_id = ?3 AND p.a_id = CASE WHEN r.a_id = ?2 THEN r.b_id ELSE r.a_id END)))`,
  joiningRelationships: `SELECT count(*) AS n FROM character_relationships
    WHERE branch_id = ?1 AND ((a_id = ?2 AND b_id = ?3) OR (a_id = ?3 AND b_id = ?2))`,
  inverseRefs: `SELECT count(*) AS n FROM entities e
    WHERE e.branch_id = ?1 AND e.id NOT IN (?2, ?3) AND (
      json_extract(e.state, '$.current_location_id') = ?2
      OR json_extract(e.state, '$.faction_id') = ?2
      OR json_extract(e.state, '$.parent_location_id') = ?2
      OR json_extract(e.state, '$.at_location_id') = ?2
      OR EXISTS (SELECT 1 FROM json_each(e.state, '$.equipped_items') WHERE value = ?2)
      OR EXISTS (SELECT 1 FROM json_each(e.state, '$.inventory') WHERE value = ?2))`,
  translationRows: `SELECT count(*) AS n FROM translations
    WHERE branch_id = ?1 AND (
      (target_kind = 'entity' AND target_id = ?2)
      OR (target_kind = 'character_relationship' AND target_id IN (
        SELECT id FROM character_relationships WHERE branch_id = ?1 AND (a_id = ?2 OR b_id = ?2))))`,
} as const

function dbCount(sql: string, id: string, partnerId: string): number {
  const params = sql.includes('?3') ? ['b1', id, partnerId] : ['b1', id]
  return (sqlite.prepare(sql).get(...params) as { n: number }).n
}

function sources(): CollisionSources {
  return {
    branchId: 'b1',
    entities: [...entitiesStore.getEntities().values()],
    awareness: [...happeningAwarenessStore.getAwareness().values()],
    involvements: [...happeningInvolvementsStore.getInvolvements().values()],
    relationships: [...characterRelationshipsStore.getRelationshipRows().values()],
    translations: [...translationsStore.getTranslations().values()],
  }
}

beforeEach(async () => {
  const test = await createTestDb()
  sqlite = test.sqlite
  const db = test.db
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(entities).values([
    entity('char_a', 'character', 'Brannoc', 1, {
      current_location_id: 'loc_a',
      faction_id: 'fac_a',
      equipped_items: ['item_a'],
      inventory: ['item_x'],
    }),
    entity(
      'char_b',
      'character',
      'Brannoc',
      2,
      { inventory: ['item_a', 'item_y', 'item_z'] },
      { nameCollisionFlag: 1, embeddingStale: 1, description: 'A smith.' },
    ),
    entity('char_c', 'character', 'Mira', 1, {
      current_location_id: 'loc_a',
      faction_id: 'fac_a',
      inventory: ['item_a'],
    }),
    entity('loc_a', 'location', 'Harbor', 1),
    entity('loc_b', 'location', 'Harbor', 2, { parent_location_id: 'loc_a' }),
    entity('loc_c', 'location', 'Dock', 1, { parent_location_id: 'loc_a' }),
    entity('item_a', 'item', 'Lantern', 5),
    entity('item_b', 'item', 'Lantern', 5, { at_location_id: 'loc_a' }),
    entity('item_x', 'item', 'Rope', 1),
    entity('item_y', 'item', 'Coin', 1),
    entity('item_z', 'item', 'Key', 1),
    entity('fac_a', 'faction', 'Guild', 1),
    entity('fac_b', 'faction', 'Guild', 2),
    entity('char_x', 'character', 'Xan', 1),
    // Carries both Lanterns: a merge leaves them one, so they don't lose the item.
    entity('char_k', 'character', 'Kes', 1, { inventory: ['item_a', 'item_b'] }),
    // A legacy row with no stored state, and its namesake carrying the empty defaults.
    { ...entity('char_n1', 'character', 'Nilsen', 1), state: null } as unknown as NewEntity,
    entity('char_n2', 'character', 'Nilsen', 2),
    // item_q is held and item_p is nowhere: no position on either side of the pair to drop for.
    entity('char_h', 'character', 'Holden', 1, { inventory: ['item_q'] }),
    entity('item_p', 'item', 'Pebble', 1),
    entity('item_q', 'item', 'Pebble', 2),
  ])
  await db.insert(happenings).values([
    { id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 },
    { id: 'hap_2', branchId: 'b1', title: 'Flood', createdAt: 1, updatedAt: 1 },
    { id: 'hap_3', branchId: 'b1', title: 'Feast', createdAt: 1, updatedAt: 1 },
  ])
  await db.insert(happeningAwareness).values([
    { id: 'haw_a1', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_a' },
    { id: 'haw_a2', branchId: 'b1', happeningId: 'hap_2', characterId: 'char_a' },
    { id: 'haw_b1', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_b' },
    { id: 'haw_b3', branchId: 'b1', happeningId: 'hap_3', characterId: 'char_b' },
  ])
  await db.insert(happeningInvolvements).values([
    { id: 'hinv_a1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_a', role: 'host' },
    { id: 'hinv_b1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_b', role: 'witness' },
    { id: 'hinv_b1x', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_b', role: 'thief' },
    { id: 'hinv_b2', branchId: 'b1', happeningId: 'hap_2', entityId: 'char_b', role: null },
  ])
  await db
    .insert(characterRelationships)
    .values([
      relationship('rel_ab', 'char_a', 'char_b'),
      relationship('rel_ac', 'char_a', 'char_c'),
      relationship('rel_bc', 'char_b', 'char_c'),
      relationship('rel_bx', 'char_b', 'char_x'),
    ])
  await db
    .insert(translations)
    .values([
      translation('tr_a', 'entity', 'char_a'),
      translation('tr_c', 'entity', 'char_c'),
      translation('tr_ab', 'character_relationship', 'rel_ab'),
      translation('tr_ac', 'character_relationship', 'rel_ac'),
      translation('tr_bc', 'character_relationship', 'rel_bc'),
    ])

  entitiesStore.hydrate('b1', (await db.select().from(entities)) as never)
  happeningAwarenessStore.hydrate('b1', await db.select().from(happeningAwareness))
  happeningInvolvementsStore.hydrate('b1', await db.select().from(happeningInvolvements))
  characterRelationshipsStore.hydrate('b1', await db.select().from(characterRelationships))
  translationsStore.hydrate('b1', await db.select().from(translations))
})

describe('collisionPair', () => {
  it('builds a fixture that reaches every inverse-ref field and link table', () => {
    // current_location_id ×2, parent_location_id, at_location_id; the partner's parent excluded.
    expect(dbCount(SQL.inverseRefs, 'loc_a', 'loc_b')).toBe(4)
    expect(dbCount(SQL.inverseRefs, 'fac_a', 'fac_b')).toBe(2)
    // equipped_items, inventory ×3 (one of them also carries item_b).
    expect(dbCount(SQL.inverseRefs, 'item_a', 'item_b')).toBe(4)
    expect(dbCount(SQL.awarenessRows, 'char_a', 'char_b')).toBe(2)
    expect(dbCount(SQL.involvements, 'char_b', 'char_a')).toBe(3)
    // rel_ac only: rel_ab joins the pair.
    expect(dbCount(SQL.relationships, 'char_a', 'char_b')).toBe(1)
    expect(dbCount(SQL.translationRows, 'char_a', 'char_b')).toBe(3)
    // rel_ac and rel_bc both name char_c; rel_bx names char_x, which char_a has no view of.
    expect(dbCount(SQL.overlapRelationships, 'char_a', 'char_b')).toBe(1)
    expect(dbCount(SQL.overlapRelationships, 'char_b', 'char_a')).toBe(1)
    expect(dbCount(SQL.relationships, 'char_b', 'char_a')).toBe(2)
    expect(dbCount(SQL.joiningRelationships, 'char_a', 'char_b')).toBe(1)
  })

  it.each([
    ['char_a', 'char_b'],
    ['loc_a', 'loc_b'],
    ['fac_a', 'fac_b'],
    ['item_a', 'item_b'],
    ['item_p', 'item_q'],
  ] as const)('%s and %s carry the DB counts on both sides', (x, y) => {
    const pair = collisionPair([x, y], sources())
    expect(pair).not.toBeNull()
    const [older, newer] = pair!
    for (const [side, partner] of [
      [older, newer],
      [newer, older],
    ]) {
      expect(side.relationCounts).toMatchObject({
        awarenessRows: dbCount(SQL.awarenessRows, side.id, partner.id),
        involvements: dbCount(SQL.involvements, side.id, partner.id),
        relationships: dbCount(SQL.relationships, side.id, partner.id),
        inverseRefs: dbCount(SQL.inverseRefs, side.id, partner.id),
        translationRows: dbCount(SQL.translationRows, side.id, partner.id),
        joiningRelationship: dbCount(SQL.joiningRelationships, side.id, partner.id) > 0,
        overlap: {
          relationships: dbCount(SQL.overlapRelationships, side.id, partner.id),
        },
      })
    }
  })

  it('counts embeddings, unheld items and the overlap in each direction', () => {
    const [a, b] = collisionPair(['char_a', 'char_b'], sources())!
    expect(a.relationCounts).toMatchObject({
      embeddings: 1,
      unheldItems: 1,
      overlap: { awareness: 1, involvements: 1, relationships: 1 },
    })
    expect(b.relationCounts).toMatchObject({
      embeddings: 0,
      unheldItems: 2,
      overlap: { awareness: 1, involvements: 2, relationships: 1 },
    })
  })

  it('counts the holders who lose an item only when the partner item already has a position', () => {
    // item_b is placed at loc_a, so the holders of item_a lose it, but not char_k, who carries
    // item_b too. item_a is held; the only holder of item_b also holds item_a.
    const [a, b] = collisionPair(['item_a', 'item_b'], sources())!
    expect(a.relationCounts.inverseRefs).toBe(4)
    expect(a.relationCounts.overlap.holdersLosingItem).toBe(3)
    expect(b.relationCounts.inverseRefs).toBe(1)
    expect(b.relationCounts.overlap.holdersLosingItem).toBe(0)
    // Neither Pebble has a position: char_h's hold on item_q moves to item_p, nobody loses it.
    const [p, q] = collisionPair(['item_p', 'item_q'], sources())!
    expect(q.relationCounts.inverseRefs).toBe(1)
    expect(p.relationCounts.overlap.holdersLosingItem).toBe(0)
    expect(q.relationCounts.overlap.holdersLosingItem).toBe(0)
    // Only items have holders to lose.
    expect(collisionPair(['loc_a', 'loc_b'], sources())![0].relationCounts.overlap).toMatchObject({
      holdersLosingItem: 0,
    })
  })

  it.each([
    ['char_a', 'char_b'],
    ['char_b', 'char_a'],
    ['loc_a', 'loc_b'],
    ['loc_b', 'loc_a'],
    ['fac_b', 'fac_a'],
    ['item_b', 'item_a'],
    ['item_a', 'item_b'],
    ['item_p', 'item_q'],
    ['item_q', 'item_p'],
  ] as const)(
    'overlap and inverse refs on the loser of %s <- %s match what the merge planner does',
    (canonicalId, loserId) => {
      const src = sources()
      const pair = collisionPair([canonicalId, loserId], src)!
      const loserSummary = pair.find((side) => side.id === loserId)!
      const lookup = collisionPairOf(src.entities, [canonicalId, loserId])
      if ('miss' in lookup) throw new Error(`not a collision pair: ${lookup.miss}`)
      const plan = entityMergeActions({
        branchId: 'b1',
        pair: lookup.pair,
        canonicalId,
        fromLoser: [],
        deselectedTags: [],
        deselectedKeywords: [],
        branchEntities: src.entities,
        awareness: src.awareness,
        involvements: src.involvements,
        relationships: src.relationships,
        tail: null,
        newId: (prefix) => `${prefix}_new`,
      })
      expect(plan.dropped).toEqual(loserSummary.relationCounts.overlap)
      const rewrittenOthers = plan.actions.filter(
        (a) =>
          a.kind === 'updateEntity' && a.payload.id !== canonicalId && a.payload.id !== loserId,
      )
      expect(rewrittenOthers).toHaveLength(loserSummary.relationCounts.inverseRefs)
    },
  )

  it('copies the scalars with an ISO createdAt and undefined for null prose', () => {
    const [a, b] = collisionPair(['char_a', 'char_b'], sources())!
    expect(a).toMatchObject({
      id: 'char_a',
      kind: 'character',
      name: 'Brannoc',
      status: 'active',
      injectionMode: 'auto',
      priority: 0,
      tags: [],
      keywords: [],
      createdAt: new Date(1).toISOString(),
    })
    expect(a.description).toBeUndefined()
    expect(a.retiredReason).toBeUndefined()
    expect(b.description).toBe('A smith.')
    expect(a.state).toMatchObject({ current_location_id: 'loc_a', faction_id: 'fac_a' })
  })

  it('puts the older row first whatever the input order', () => {
    expect(collisionPair(['char_b', 'char_a'], sources())!.map((s) => s.id)).toEqual([
      'char_a',
      'char_b',
    ])
  })

  it('breaks a createdAt tie by id', () => {
    expect(collisionPair(['item_b', 'item_a'], sources())!.map((s) => s.id)).toEqual([
      'item_a',
      'item_b',
    ])
  })

  it('returns null when a row of the pair is gone, whichever one', () => {
    expect(collisionPair(['char_a', 'char_gone'], sources())).toBeNull()
    expect(collisionPair(['char_gone', 'char_a'], sources())).toBeNull()
  })

  it('returns null for a row paired with itself', () => {
    expect(collisionPair(['char_a', 'char_a'], sources())).toBeNull()
  })

  it('reads a null stored state as the kind’s defaults, equal to a namesake carrying them', () => {
    const [legacy, defaults] = collisionPair(['char_n1', 'char_n2'], sources())!
    expect(legacy.state).toEqual(emptyEntityState('character'))
    expect(legacy.state).toEqual(defaults.state)
  })
})
