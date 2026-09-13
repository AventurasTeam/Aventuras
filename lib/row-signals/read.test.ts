import { describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  type NewCharacterRelationship,
  type NewDelta,
  type NewEntity,
  type NewHappening,
  type NewHappeningAwareness,
  type NewHappeningInvolvement,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { latestReplyIds, readReplyEdits, readSignalDeltas, readTurnBoundaries } from './read'
import type { SignalEntry } from './types'

const ENTRIES: SignalEntry[] = [
  { id: 'e1', kind: 'opening', position: 1, metadata: null },
  { id: 'e2', kind: 'user_action', position: 2, metadata: null },
  { id: 'e3', kind: 'ai_reply', position: 3, metadata: null },
  { id: 'e4', kind: 'user_action', position: 4, metadata: null },
  { id: 'e5', kind: 'ai_reply', position: 5, metadata: null },
  { id: 'e6', kind: 'system', position: 6, metadata: null },
]

type RowOptions = {
  id: string
  logPosition: number
  targetTable: string
  targetId: string
  op: NewDelta['op']
  source: NewDelta['source']
  undoPayload?: Record<string, unknown> | null
  actionId?: string
  branchId?: string
}

function row(opts: RowOptions): NewDelta {
  return {
    id: opts.id,
    branchId: opts.branchId ?? 'b1',
    entryId: null,
    actionId: opts.actionId ?? `act_${opts.id}`,
    logPosition: opts.logPosition,
    source: opts.source,
    targetTable: opts.targetTable,
    targetId: opts.targetId,
    op: opts.op,
    undoPayload: opts.undoPayload ?? null,
    encodingVersion: 1,
    createdAt: opts.logPosition,
  }
}

function happeningRow(overrides: Partial<NewHappening> & Pick<NewHappening, 'id'>): NewHappening {
  return { branchId: 'b1', title: 'The ambush', createdAt: 1, updatedAt: 1, ...overrides }
}

function entityRow(overrides: Partial<NewEntity> & Pick<NewEntity, 'id' | 'name'>): NewEntity {
  return {
    branchId: 'b1',
    kind: 'character',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function awarenessRow(
  overrides: Partial<NewHappeningAwareness> &
    Pick<NewHappeningAwareness, 'id' | 'happeningId' | 'characterId'>,
): NewHappeningAwareness {
  return {
    branchId: 'b1',
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
    ...overrides,
  }
}

function involvementRow(
  overrides: Partial<NewHappeningInvolvement> &
    Pick<NewHappeningInvolvement, 'id' | 'happeningId' | 'entityId'>,
): NewHappeningInvolvement {
  return { branchId: 'b1', role: null, ...overrides }
}

function relationshipRow(
  overrides: Partial<NewCharacterRelationship> &
    Pick<NewCharacterRelationship, 'id' | 'aId' | 'bId'>,
): NewCharacterRelationship {
  return {
    branchId: 'b1',
    kind: 'ally',
    inverseKind: 'ally',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

async function seed() {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })
  await db.insert(deltas).values([
    row({
      id: 'd1',
      logPosition: 1,
      targetTable: 'story_entries',
      targetId: 'e1',
      op: 'create',
      source: 'user_edit',
    }),
    row({
      id: 'd2',
      logPosition: 2,
      targetTable: 'story_entries',
      targetId: 'e2',
      op: 'create',
      source: 'user_edit',
    }),
    row({
      id: 'd3',
      logPosition: 3,
      targetTable: 'story_entries',
      targetId: 'e3',
      op: 'create',
      source: 'ai_classifier',
    }),
    row({
      id: 'd4',
      logPosition: 4,
      targetTable: 'entities',
      targetId: 'char_fading',
      op: 'update',
      source: 'per_turn_classifier',
    }),
    row({
      id: 'd5',
      logPosition: 5,
      targetTable: 'story_entries',
      targetId: 'e4',
      op: 'create',
      source: 'user_edit',
    }),
    row({
      id: 'd6',
      logPosition: 6,
      targetTable: 'story_entries',
      targetId: 'e5',
      op: 'create',
      source: 'ai_classifier',
    }),
    row({
      id: 'd7',
      logPosition: 7,
      targetTable: 'entities',
      targetId: 'char_fresh',
      op: 'create',
      source: 'periodic_classifier',
    }),
    row({
      id: 'd8',
      logPosition: 8,
      targetTable: 'entities',
      targetId: 'char_user',
      op: 'update',
      source: 'user_edit',
    }),
    row({
      id: 'd9',
      logPosition: 9,
      targetTable: 'chapters',
      targetId: 'chap_1',
      op: 'create',
      source: 'chapter_close',
    }),
    row({
      id: 'd10',
      logPosition: 10,
      targetTable: 'lore',
      targetId: 'lore_1',
      op: 'update',
      source: 'lore_agent',
    }),
    // Non-create delta on an id with no create delta — pins the `op = 'create'` filter.
    row({
      id: 'd11',
      logPosition: 11,
      targetTable: 'story_entries',
      targetId: 'e99',
      op: 'update',
      source: 'user_edit',
    }),
  ])
  return db
}

async function seedLinkFixtures() {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })
  await db.insert(happenings).values(happeningRow({ id: 'hap_1' }))
  await db
    .insert(entities)
    .values([
      entityRow({ id: 'char_kael', name: 'Kael' }),
      entityRow({ id: 'char_mira', name: 'Mira' }),
    ])
  return db
}

describe('latestReplyIds', () => {
  it('returns the last two ai_reply ids, latest first, skipping system rows', () => {
    expect(latestReplyIds(ENTRIES)).toEqual(['e5', 'e3'])
    expect(latestReplyIds(ENTRIES.slice(0, 3))).toEqual(['e3'])
    expect(latestReplyIds([])).toEqual([])
  })
})

describe('readTurnBoundaries', () => {
  it('maps the last two replies to the log positions of their create deltas', async () => {
    const db = await seed()
    expect(await readTurnBoundaries(db, 'b1', ENTRIES)).toEqual({ fresh: 6, fading: 3 })
  })

  it('has no fading boundary on a one-reply branch, and none at all without a reply', async () => {
    const db = await seed()
    expect(await readTurnBoundaries(db, 'b1', ENTRIES.slice(0, 3))).toEqual({
      fresh: 3,
      fading: null,
    })
    expect(await readTurnBoundaries(db, 'b1', ENTRIES.slice(0, 2))).toBeNull()
  })

  it('returns null when the latest reply has no create delta on this branch', async () => {
    const db = await seed()
    const other: SignalEntry[] = [{ id: 'e99', kind: 'ai_reply', position: 99, metadata: null }]
    expect(await readTurnBoundaries(db, 'b1', other)).toBeNull()
  })

  it('does not resolve a boundary from another branch (fork-copied entry ids)', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values([
      { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
      { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
    ])
    await db.insert(deltas).values(
      row({
        id: 'd_b2',
        logPosition: 5,
        targetTable: 'story_entries',
        targetId: 'e5',
        op: 'create',
        source: 'ai_classifier',
        branchId: 'b2',
      }),
    )
    const other: SignalEntry[] = [{ id: 'e5', kind: 'ai_reply', position: 5, metadata: null }]
    expect(await readTurnBoundaries(db, 'b1', other)).toBeNull()
  })
})

describe('readSignalDeltas', () => {
  it('returns pipeline deltas on row-surface tables at or after the position, ascending', async () => {
    const db = await seed()
    const rows = await readSignalDeltas(db, 'b1', 3)
    expect(rows.map((r) => [r.logPosition, r.targetId])).toEqual([
      [4, 'char_fading'],
      [7, 'char_fresh'],
      [10, 'lore_1'],
    ])
  })
})

describe('readSignalDeltas — link attribution', () => {
  it('resolves an awareness create to its happening + character owners, honoring the window edge', async () => {
    const db = await seedLinkFixtures()
    await db
      .insert(happeningAwareness)
      .values(awarenessRow({ id: 'haw_1', happeningId: 'hap_1', characterId: 'char_kael' }))
    await db.insert(deltas).values([
      row({
        id: 'd_before',
        logPosition: 9,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'create',
        source: 'periodic_classifier',
      }),
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'create',
        source: 'periodic_classifier',
      }),
    ])
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'periodic_classifier',
        targetTable: 'happenings',
        targetId: 'hap_1',
        logPosition: 10,
      },
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_kael',
        logPosition: 10,
      },
    ])
  })

  it('resolves a relationship update to both entity owners', async () => {
    const db = await seedLinkFixtures()
    await db
      .insert(characterRelationships)
      .values(relationshipRow({ id: 'rel_1', aId: 'char_kael', bId: 'char_mira' }))
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'character_relationships',
        targetId: 'rel_1',
        op: 'update',
        source: 'per_turn_classifier',
        undoPayload: { kind: 'stranger' },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'per_turn_classifier',
        targetTable: 'entities',
        targetId: 'char_kael',
        logPosition: 10,
      },
      {
        source: 'per_turn_classifier',
        targetTable: 'entities',
        targetId: 'char_mira',
        logPosition: 10,
      },
    ])
  })

  it('resolves an involvement delete to its owners from the undo payload, not a row lookup', async () => {
    const db = await seedLinkFixtures()
    // The involvement row is gone — only its delete delta's undo payload carries the owners.
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_involvements',
        targetId: 'inv_gone',
        op: 'delete',
        source: 'periodic_classifier',
        undoPayload: {
          id: 'inv_gone',
          branchId: 'b1',
          happeningId: 'hap_1',
          entityId: 'char_mira',
          role: 'witness',
        },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'periodic_classifier',
        targetTable: 'happenings',
        targetId: 'hap_1',
        logPosition: 10,
      },
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_mira',
        logPosition: 10,
      },
    ])
  })

  it('skips a retrieval-count-only awareness update', async () => {
    const db = await seedLinkFixtures()
    await db.insert(happeningAwareness).values(
      awarenessRow({
        id: 'haw_1',
        happeningId: 'hap_1',
        characterId: 'char_kael',
        retrievalCount: 3,
      }),
    )
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'update',
        source: 'ai_classifier',
        undoPayload: { retrievalCount: 3 },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([])
  })

  it('excludes a user_edit link delta entirely', async () => {
    const db = await seedLinkFixtures()
    await db
      .insert(happeningAwareness)
      .values(awarenessRow({ id: 'haw_1', happeningId: 'hap_1', characterId: 'char_kael' }))
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'update',
        source: 'user_edit',
        undoPayload: { source: 'manual edit' },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([])
  })

  it('keeps a genuine awareness update but drops a same-row retrieval bump', async () => {
    const db = await seedLinkFixtures()
    await db.insert(happeningAwareness).values(
      awarenessRow({
        id: 'haw_1',
        happeningId: 'hap_1',
        characterId: 'char_kael',
        retrievalCount: 4,
        source: 'new source',
      }),
    )
    await db.insert(deltas).values([
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'update',
        source: 'ai_classifier',
        undoPayload: { source: 'old source' },
      }),
      row({
        id: 'd2',
        logPosition: 11,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'update',
        source: 'ai_classifier',
        undoPayload: { retrievalCount: 3 },
      }),
    ])
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      { source: 'ai_classifier', targetTable: 'happenings', targetId: 'hap_1', logPosition: 10 },
      { source: 'ai_classifier', targetTable: 'entities', targetId: 'char_kael', logPosition: 10 },
    ])
  })

  it('resolves an involvement update to its happening + entity owners via a row lookup', async () => {
    const db = await seedLinkFixtures()
    await db.insert(happeningInvolvements).values(
      involvementRow({
        id: 'inv_1',
        happeningId: 'hap_1',
        entityId: 'char_mira',
        role: 'witness',
      }),
    )
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_involvements',
        targetId: 'inv_1',
        op: 'update',
        source: 'periodic_classifier',
        undoPayload: { role: 'onlooker' },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'periodic_classifier',
        targetTable: 'happenings',
        targetId: 'hap_1',
        logPosition: 10,
      },
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_mira',
        logPosition: 10,
      },
    ])
  })

  it('resolves an awareness delete to its owners from the undo payload', async () => {
    const db = await seedLinkFixtures()
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_awareness',
        targetId: 'haw_gone',
        op: 'delete',
        source: 'periodic_classifier',
        undoPayload: {
          id: 'haw_gone',
          branchId: 'b1',
          happeningId: 'hap_1',
          characterId: 'char_kael',
          learnedAtEntryId: null,
          decayResistance: null,
          retrievalCount: 2,
          source: null,
        },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'periodic_classifier',
        targetTable: 'happenings',
        targetId: 'hap_1',
        logPosition: 10,
      },
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_kael',
        logPosition: 10,
      },
    ])
  })

  it('drops a link delete whose undo payload is missing an owner key', async () => {
    const db = await seedLinkFixtures()
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_awareness',
        targetId: 'haw_gone',
        op: 'delete',
        source: 'periodic_classifier',
        undoPayload: {
          id: 'haw_gone',
          branchId: 'b1',
          happeningId: 'hap_1',
          learnedAtEntryId: null,
          decayResistance: null,
          retrievalCount: 2,
          source: null,
        },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([])
  })

  it('resolves a relationship delete to its owners from the undo payload', async () => {
    const db = await seedLinkFixtures()
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'character_relationships',
        targetId: 'rel_gone',
        op: 'delete',
        source: 'per_turn_classifier',
        undoPayload: {
          id: 'rel_gone',
          branchId: 'b1',
          aId: 'char_kael',
          bId: 'char_mira',
          kind: 'ally',
          inverseKind: 'ally',
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'per_turn_classifier',
        targetTable: 'entities',
        targetId: 'char_kael',
        logPosition: 10,
      },
      {
        source: 'per_turn_classifier',
        targetTable: 'entities',
        targetId: 'char_mira',
        logPosition: 10,
      },
    ])
  })

  it('returns row-table and link deltas merged in ascending log-position order', async () => {
    const db = await seedLinkFixtures()
    await db
      .insert(happeningAwareness)
      .values(awarenessRow({ id: 'haw_1', happeningId: 'hap_1', characterId: 'char_kael' }))
    await db.insert(deltas).values([
      row({
        id: 'd_row_early',
        logPosition: 10,
        targetTable: 'entities',
        targetId: 'char_kael',
        op: 'update',
        source: 'periodic_classifier',
      }),
      row({
        id: 'd_link',
        logPosition: 11,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'create',
        source: 'periodic_classifier',
      }),
      row({
        id: 'd_row_late',
        logPosition: 12,
        targetTable: 'entities',
        targetId: 'char_mira',
        op: 'update',
        source: 'periodic_classifier',
      }),
    ])
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_kael',
        logPosition: 10,
      },
      {
        source: 'periodic_classifier',
        targetTable: 'happenings',
        targetId: 'hap_1',
        logPosition: 11,
      },
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_kael',
        logPosition: 11,
      },
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_mira',
        logPosition: 12,
      },
    ])
  })

  it('scopes the bounded delta read to the given branch', async () => {
    const db = await seedLinkFixtures()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await db.insert(deltas).values([
      row({
        id: 'd_b1',
        logPosition: 10,
        targetTable: 'entities',
        targetId: 'char_kael',
        op: 'update',
        source: 'periodic_classifier',
      }),
      row({
        id: 'd_b2',
        logPosition: 10,
        targetTable: 'entities',
        targetId: 'char_kael',
        op: 'update',
        source: 'periodic_classifier',
        branchId: 'b2',
      }),
    ])
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([
      {
        source: 'periodic_classifier',
        targetTable: 'entities',
        targetId: 'char_kael',
        logPosition: 10,
      },
    ])
  })

  it('scopes the awareness link lookup to the given branch', async () => {
    const db = await seedLinkFixtures()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    // The link row exists only on b2 — a b1 lookup must not leak across branches.
    await db.insert(happeningAwareness).values(
      awarenessRow({
        id: 'haw_1',
        happeningId: 'hap_1',
        characterId: 'char_kael',
        branchId: 'b2',
      }),
    )
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_awareness',
        targetId: 'haw_1',
        op: 'create',
        source: 'periodic_classifier',
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([])
  })

  it('scopes the involvement link lookup to the given branch', async () => {
    const db = await seedLinkFixtures()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await db.insert(happeningInvolvements).values(
      involvementRow({
        id: 'inv_1',
        happeningId: 'hap_1',
        entityId: 'char_kael',
        branchId: 'b2',
      }),
    )
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'happening_involvements',
        targetId: 'inv_1',
        op: 'create',
        source: 'periodic_classifier',
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([])
  })

  it('scopes the relationship link lookup to the given branch', async () => {
    const db = await seedLinkFixtures()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await db
      .insert(characterRelationships)
      .values(relationshipRow({ id: 'rel_1', aId: 'char_kael', bId: 'char_mira', branchId: 'b2' }))
    await db.insert(deltas).values(
      row({
        id: 'd1',
        logPosition: 10,
        targetTable: 'character_relationships',
        targetId: 'rel_1',
        op: 'update',
        source: 'per_turn_classifier',
        undoPayload: { kind: 'stranger' },
      }),
    )
    const rows = await readSignalDeltas(db, 'b1', 10)
    expect(rows).toEqual([])
  })
})

describe('readReplyEdits', () => {
  it("returns the replies' user_edit updates on story_entries, oldest first, on this branch only", async () => {
    const db = await seedLinkFixtures()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await db.insert(deltas).values([
      row({
        id: 'd_second',
        logPosition: 14,
        targetTable: 'story_entries',
        targetId: 'e5',
        op: 'update',
        source: 'user_edit',
        undoPayload: { metadata: { currentLocationId: 'loc_1' } },
      }),
      row({
        id: 'd_first',
        logPosition: 12,
        targetTable: 'story_entries',
        targetId: 'e5',
        op: 'update',
        source: 'user_edit',
        undoPayload: { metadata: { sceneEntities: ['char_kael'] } },
      }),
      row({
        id: 'd_fold',
        logPosition: 11,
        targetTable: 'story_entries',
        targetId: 'e5',
        op: 'update',
        source: 'per_turn_classifier',
      }),
      row({
        id: 'd_create',
        logPosition: 10,
        targetTable: 'story_entries',
        targetId: 'e5',
        op: 'create',
        source: 'user_edit',
      }),
      row({
        id: 'd_not_reply',
        logPosition: 13,
        targetTable: 'story_entries',
        targetId: 'e4',
        op: 'update',
        source: 'user_edit',
      }),
      row({
        id: 'd_entity',
        logPosition: 15,
        targetTable: 'entities',
        targetId: 'e5',
        op: 'update',
        source: 'user_edit',
      }),
      row({
        id: 'd_fork',
        logPosition: 16,
        targetTable: 'story_entries',
        targetId: 'e5',
        op: 'update',
        source: 'user_edit',
        branchId: 'b2',
      }),
    ])
    expect(await readReplyEdits(db, 'b1', ['e5', 'e3'])).toEqual([
      {
        targetId: 'e5',
        logPosition: 12,
        undoPayload: { metadata: { sceneEntities: ['char_kael'] } },
      },
      {
        targetId: 'e5',
        logPosition: 14,
        undoPayload: { metadata: { currentLocationId: 'loc_1' } },
      },
    ])
  })
})
