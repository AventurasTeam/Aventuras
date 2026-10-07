import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  type CharacterRelationship,
  type DbCtx,
  type HappeningAwareness,
  type HappeningInvolvement,
  type NewDelta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { loadLinkEnds, type LinkEnds } from './link-ends'

let db: DbCtx['db']
let position = 0

const character = (id: string, name: string, branchId = 'b1'): NewEntity => ({
  id,
  branchId,
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const relationship = (
  id: string,
  aId: string,
  bId: string,
  branchId = 'b1',
): CharacterRelationship => ({
  id,
  branchId,
  aId,
  bId,
  kind: 'ally',
  inverseKind: null,
  createdAt: 1,
  updatedAt: 1,
})

const involvement = (id: string, entityId: string, happeningId: string): HappeningInvolvement => ({
  id,
  branchId: 'b1',
  happeningId,
  entityId,
  role: null,
})

const awareness = (id: string, characterId: string, happeningId: string): HappeningAwareness => ({
  id,
  branchId: 'b1',
  happeningId,
  characterId,
  learnedAtEntryId: null,
  decayResistance: null,
  retrievalCount: 0,
  source: null,
})

function deleted(
  targetTable: string,
  targetId: string,
  undoPayload: Record<string, unknown>,
  branchId = 'b1',
): NewDelta {
  position += 1
  return {
    id: `delta_${position}`,
    branchId,
    entryId: null,
    actionId: `act_${position}`,
    logPosition: position,
    source: 'user_edit',
    targetTable,
    targetId,
    op: 'delete',
    undoPayload,
    createdAt: position,
  }
}

const byLinkId = (ends: LinkEnds) =>
  [...ends.links].sort((x, y) => x.linkId.localeCompare(y.linkId))

beforeEach(async () => {
  position = 0
  const test = await createTestDb()
  db = test.db
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'alt', createdAt: 1 },
  ])
  await db
    .insert(entities)
    .values([
      character('char_abe', 'Abe'),
      character('char_aria', 'Aria'),
      character('char_kael', 'Kael'),
      character('char_mira', 'Mira'),
    ])
  await db
    .insert(happenings)
    .values([
      { id: 'hap_fire', branchId: 'b1', title: 'The keep burns', createdAt: 1, updatedAt: 1 },
    ])
})

describe('loadLinkEnds', () => {
  it("finds a character's live link rows at each end that names it", async () => {
    await db
      .insert(characterRelationships)
      .values([
        relationship('rel_1', 'char_aria', 'char_kael'),
        relationship('rel_2', 'char_abe', 'char_aria'),
        relationship('rel_3', 'char_abe', 'char_kael'),
      ])
    await db.insert(happeningInvolvements).values(involvement('hinv_1', 'char_aria', 'hap_fire'))
    await db.insert(happeningAwareness).values(awareness('haw_1', 'char_aria', 'hap_fire'))
    const ends = await loadLinkEnds(db, 'b1', 'entities', 'char_aria')
    expect(byLinkId(ends)).toEqual([
      { table: 'happening_awareness', linkId: 'haw_1', otherId: 'hap_fire', side: null },
      { table: 'happening_involvements', linkId: 'hinv_1', otherId: 'hap_fire', side: null },
      { table: 'character_relationships', linkId: 'rel_1', otherId: 'char_kael', side: 'a' },
      { table: 'character_relationships', linkId: 'rel_2', otherId: 'char_abe', side: 'b' },
    ])
    expect(ends.removals).toEqual([])
    expect(ends.names).toEqual({ char_abe: 'Abe', char_kael: 'Kael', hap_fire: 'The keep burns' })
  })

  it('finds a link row deleted on its own through the ends its delete payload names', async () => {
    await db
      .insert(deltas)
      .values([
        deleted(
          'character_relationships',
          'rel_9',
          relationship('rel_9', 'char_aria', 'char_mira'),
        ),
        deleted('happening_awareness', 'haw_9', awareness('haw_9', 'char_kael', 'hap_fire')),
      ])
    const ends = await loadLinkEnds(db, 'b1', 'entities', 'char_aria')
    expect(ends.links).toEqual([
      { table: 'character_relationships', linkId: 'rel_9', otherId: 'char_mira', side: 'a' },
    ])
    expect(ends.removals).toEqual([])
  })

  it("finds the link rows another row's delete cascaded, and lists that delete once as a removal", async () => {
    await db.insert(deltas).values([
      deleted('entities', 'char_zed', {
        id: 'char_zed',
        name: 'Zed',
        relationships: [
          relationship('rel_5', 'char_aria', 'char_zed'),
          relationship('rel_6', 'char_kael', 'char_zed'),
        ],
        involvements: [involvement('hinv_5', 'char_zed', 'hap_fire')],
        awareness: [],
        translations: [],
      }),
      deleted('happenings', 'hap_flood', {
        id: 'hap_flood',
        title: 'The flood',
        involvements: [involvement('hinv_7', 'char_aria', 'hap_flood')],
        awareness: [
          awareness('haw_7', 'char_aria', 'hap_flood'),
          awareness('haw_8', 'char_aria', 'hap_flood'),
        ],
        translations: [],
      }),
    ])
    const ends = await loadLinkEnds(db, 'b1', 'entities', 'char_aria')
    expect(byLinkId(ends)).toEqual([
      { table: 'happening_awareness', linkId: 'haw_7', otherId: 'hap_flood', side: null },
      { table: 'happening_awareness', linkId: 'haw_8', otherId: 'hap_flood', side: null },
      { table: 'happening_involvements', linkId: 'hinv_7', otherId: 'hap_flood', side: null },
      { table: 'character_relationships', linkId: 'rel_5', otherId: 'char_zed', side: 'a' },
    ])
    expect(ends.removals).toEqual([
      { deltaId: 'delta_1', tables: ['character_relationships'], otherId: 'char_zed' },
      {
        deltaId: 'delta_2',
        tables: ['happening_involvements', 'happening_awareness'],
        otherId: 'hap_flood',
      },
    ])
    expect(ends.names).toEqual({ char_zed: 'Zed', hap_flood: 'The flood' })
  })

  it("reads a happening's link rows by happening_id, live and from an entity delete's payload", async () => {
    await db.insert(happeningInvolvements).values(involvement('hinv_1', 'char_kael', 'hap_fire'))
    await db.insert(happeningAwareness).values(awareness('haw_1', 'char_kael', 'hap_fire'))
    await db.insert(deltas).values(
      deleted('entities', 'char_zed', {
        id: 'char_zed',
        name: 'Zed',
        relationships: [relationship('rel_5', 'char_kael', 'char_zed')],
        involvements: [involvement('hinv_5', 'char_zed', 'hap_fire')],
        awareness: [awareness('haw_5', 'char_zed', 'hap_fire')],
      }),
    )
    const ends = await loadLinkEnds(db, 'b1', 'happenings', 'hap_fire')
    expect(byLinkId(ends)).toEqual([
      { table: 'happening_awareness', linkId: 'haw_1', otherId: 'char_kael', side: null },
      { table: 'happening_awareness', linkId: 'haw_5', otherId: 'char_zed', side: null },
      { table: 'happening_involvements', linkId: 'hinv_1', otherId: 'char_kael', side: null },
      { table: 'happening_involvements', linkId: 'hinv_5', otherId: 'char_zed', side: null },
    ])
    expect(ends.removals).toEqual([
      {
        deltaId: 'delta_1',
        tables: ['happening_involvements', 'happening_awareness'],
        otherId: 'char_zed',
      },
    ])
    expect(ends.names).toEqual({ char_kael: 'Kael', char_zed: 'Zed' })
  })

  it("keeps the links the row's own delete holds, but never lists that delete as a removal", async () => {
    await db.insert(deltas).values(
      deleted('entities', 'char_aria', {
        id: 'char_aria',
        name: 'Aria',
        relationships: [relationship('rel_8', 'char_aria', 'char_kael')],
      }),
    )
    const ends = await loadLinkEnds(db, 'b1', 'entities', 'char_aria')
    expect(ends.links).toEqual([
      { table: 'character_relationships', linkId: 'rel_8', otherId: 'char_kael', side: 'a' },
    ])
    expect(ends.removals).toEqual([])
  })

  it('names a deleted other end from its latest delete payload', async () => {
    const holding = (name: string) => ({
      id: 'char_zed',
      name,
      relationships: [relationship('rel_5', 'char_aria', 'char_zed')],
    })
    await db
      .insert(deltas)
      .values([
        deleted('entities', 'char_zed', holding('Zed')),
        deleted('entities', 'char_zed', holding('Zed the Younger')),
      ])
    const ends = await loadLinkEnds(db, 'b1', 'entities', 'char_aria')
    expect(ends.names).toEqual({ char_zed: 'Zed the Younger' })
  })

  it('stays within the branch', async () => {
    await db.insert(entities).values(character('char_aria', 'Aria', 'b2'))
    await db.insert(entities).values(character('char_kael', 'Kael', 'b2'))
    await db
      .insert(characterRelationships)
      .values(relationship('rel_1', 'char_aria', 'char_kael', 'b2'))
    await db
      .insert(deltas)
      .values(
        deleted(
          'character_relationships',
          'rel_2',
          relationship('rel_2', 'char_aria', 'char_mira', 'b2'),
          'b2',
        ),
      )
    expect(await loadLinkEnds(db, 'b1', 'entities', 'char_aria')).toEqual({
      links: [],
      removals: [],
      names: {},
    })
  })

  it("names each other end from the tab's branch, though another branch names the same id", async () => {
    await db.insert(characterRelationships).values(relationship('rel_1', 'char_aria', 'char_kael'))
    await db.insert(happeningAwareness).values(awareness('haw_1', 'char_aria', 'hap_fire'))
    await db.insert(deltas).values(
      deleted('entities', 'char_zed', {
        id: 'char_zed',
        name: 'Zed',
        relationships: [relationship('rel_5', 'char_aria', 'char_zed')],
      }),
    )
    await db.insert(entities).values(character('char_kael', 'Kael of Alt', 'b2'))
    await db
      .insert(happenings)
      .values({ id: 'hap_fire', branchId: 'b2', title: 'Alt fire', createdAt: 1, updatedAt: 1 })
    await db
      .insert(deltas)
      .values(deleted('entities', 'char_zed', { id: 'char_zed', name: 'Zed of Alt' }, 'b2'))
    const ends = await loadLinkEnds(db, 'b1', 'entities', 'char_aria')
    expect(ends.names).toEqual({ char_kael: 'Kael', hap_fire: 'The keep burns', char_zed: 'Zed' })
  })

  it('finds nothing for lore and threads, which no link row names', async () => {
    const none = { links: [], removals: [], names: {} }
    expect(await loadLinkEnds(db, 'b1', 'lore', 'lore_1')).toEqual(none)
    expect(await loadLinkEnds(db, 'b1', 'threads', 'thread_1')).toEqual(none)
  })
})
