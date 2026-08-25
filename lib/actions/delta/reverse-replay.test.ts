import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  stories,
  storyEntries,
  type NewEntity,
  type VecTargetKind,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningAwarenessStore, happeningInvolvementsStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { reverseAndPruneDeltaRows, reverseReplayDeltas } from './reverse-replay'
import type { PipelineAction } from '../types'

afterEach(() => {
  happeningAwarenessStore.__reset()
  happeningInvolvementsStore.__reset()
})

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
}

const KNIGHT: NewEntity = {
  id: 'char_1',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'a wandering knight',
  status: 'active',
  injectionMode: 'auto',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}

async function createKnight(
  ctx: {
    db: Awaited<ReturnType<typeof createTestDb>>['db']
    runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
  },
  actionId: string,
) {
  await applyDeltaAction(
    {
      action: { kind: 'createEntity', source: 'user_edit', payload: { entry: KNIGHT } },
      actionId,
      branchId: 'b1',
    },
    ctx,
  )
}

async function knightRow(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  const [row] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, 'b1'), eq(entities.id, 'char_1')))
  return row
}

describe('reverseReplayDeltas', () => {
  it('reverses create + update in DESC order, returns count', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // delta 1: create entry with metadata worldTime 5
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    // delta 2 (same action): update metadata worldTime -> 9
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 9 },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )

    const count = await reverseReplayDeltas('act_1', ctx)
    expect(count).toBe(2)
    // update reversed first (worldTime back to 5), then create reversed (row deleted)
    const rows = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(rows.length).toBe(0)
    // and no residual deltas applied wrong: assert the deltas still exist (framework consumes the primitive; deletion of delta rows is a data-model decision, not this primitive)
    expect((await db.select().from(deltas).where(eq(deltas.actionId, 'act_1'))).length).toBe(2)
  })

  it('restores a schema-backed column that was NULL before the update', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'system',
      content: 'hi',
      metadata: null,
      createdAt: 1,
    })
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )

    await reverseReplayDeltas('act_1', ctx)

    // A field-wise undo diff cannot express "the column was null" — restoring it
    // key-by-key yields {sceneEntities: null, worldTime: null, ...}, which no
    // longer parses as EntryMetadata and sticks (the next update sees an object).
    const [row] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(row.metadata).toBeNull()
  })

  it('returns 0 for an actionId with no deltas', async () => {
    const { db, runInTransaction } = await createTestDb()
    expect(await reverseReplayDeltas('act_none', { db, runInTransaction })).toBe(0)
  })

  it('runs settleOps even when the action has no deltas left to reverse', async () => {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    await db.insert(stories).values({ id: 's-settle', title: 'X', createdAt: 1, updatedAt: 1 })

    const count = await reverseReplayDeltas('act_none', { db, runInTransaction }, () => [
      db.delete(stories).where(eq(stories.id, 's-settle')).toSQL(),
    ])

    expect(count).toBe(0)
    expect(await db.select().from(stories).where(eq(stories.id, 's-settle'))).toHaveLength(0)
  })

  it('rolls the reversal back when a settleOp fails, so a retry meets untouched deltas', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await createKnight(ctx, 'act_rev')
    expect(await knightRow(db)).toBeDefined()

    await expect(
      reverseReplayDeltas('act_rev', ctx, () => [
        { sql: 'UPDATE no_such_table SET x = 1', params: [] },
      ]),
    ).rejects.toThrow()

    // Undoing a create deletes the row; the failed settle must have taken that with
    // it, or the next attempt reverses an already-reversed action.
    expect(await knightRow(db)).toBeDefined()
    expect(await db.select().from(deltas).where(eq(deltas.actionId, 'act_rev'))).toHaveLength(1)
  })

  it('reverses a single update with the row surviving (positive restore)', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // create under a SEPARATE action so the row survives reversing the update action
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_keep',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 9 },
          },
        },
        actionId: 'act_rev',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    const count = await reverseReplayDeltas('act_rev', ctx)
    expect(count).toBe(1)
    const [entry] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(entry).toBeDefined() // row survives (create was a different action)
    expect(entry.metadata).toEqual({ sceneEntities: [], currentLocationId: null, worldTime: 5 })
  })

  it('reverses two same-row updates with DISJOINT sub-keys without clobbering', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_keep',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    // update A: worldTime 5 -> 7
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 7 },
          },
        },
        actionId: 'act_rev',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    // update B: currentLocationId null -> 'loc_z' (disjoint sub-key)
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'entry_1',
            metadata: { sceneEntities: [], currentLocationId: 'loc_z', worldTime: 7 },
          },
        },
        actionId: 'act_rev',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    const count = await reverseReplayDeltas('act_rev', ctx)
    expect(count).toBe(2)
    const [entry] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    // BOTH sub-keys restored to their pre-act_rev state — no clobber
    expect(entry.metadata).toEqual({ sceneEntities: [], currentLocationId: null, worldTime: 5 })
  })

  it('delete without restoreCascade passes undo payload through untouched', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    // Create an entry without any cascade behavior
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_create',
        branchId: 'b1',
        entryId: 'entry_1',
      },
      ctx,
    )
    // Delete it
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteStoryEntry',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'entry_1' },
        },
        actionId: 'act_delete',
        branchId: 'b1',
      },
      ctx,
    )
    // Verify it's deleted
    const deleted = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(deleted.length).toBe(0)

    // Reverse the delete
    await reverseReplayDeltas('act_delete', ctx)

    // Verify it's restored with full undo payload intact
    const [restored] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(restored).toBeDefined()
    expect(restored.metadata).toEqual({ sceneEntities: [], currentLocationId: null, worldTime: 5 })
  })
})

describe('reverseAndPruneDeltaRows', () => {
  it('commits extra ops even when there are no delta rows to reverse', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const count = await reverseAndPruneDeltaRows([], ctx, [
      { sql: `UPDATE branches SET name = ? WHERE id = ?`, params: ['renamed', 'b1'] },
    ])
    expect(count).toBe(0)
    const [branch] = await db.select().from(branches).where(eq(branches.id, 'b1'))
    expect(branch.name).toBe('renamed')
  })
})

type Ctx = {
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
}

async function apply(ctx: Ctx, action: PipelineAction, actionId: string) {
  const res = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (res.status === 'rejected') throw new Error(`${action.kind} rejected: ${res.reason}`)
}

function readRow(
  sqlite: Awaited<ReturnType<typeof createTestDb>>['sqlite'],
  table: string,
  id: string,
) {
  const row = sqlite.prepare(`SELECT * FROM ${table} WHERE branch_id = 'b1' AND id = ?`).get(id)
  if (!row) throw new Error(`${table} row ${id} not found`)
  return row as Record<string, unknown>
}

// `column` is the SQL column the undo restores, `restored` its pre-update value.
type UndoCase = { action: PipelineAction; column: string; restored: unknown }
type StaleCase<K extends VecTargetKind = VecTargetKind> = {
  kind: K
  table: string
  id: string
  create: PipelineAction
  // Touches one of the kind's OWN embedded columns — spelled per kind so a lore or
  // chapter undo can't pass while the engine is matching against entity field names.
  embedded: UndoCase
  plain: UndoCase
}

// Keyed by kind so a new embedding kind fails to compile until it has a case here.
const STALE_CASES_BY_KIND: { [K in VecTargetKind]: StaleCase<K> } = {
  entity: {
    kind: 'entity',
    table: 'entities',
    id: 'char_1',
    create: { kind: 'createEntity', source: 'user_edit', payload: { entry: KNIGHT } },
    embedded: {
      action: {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_1', patch: { description: 'a retired knight' } },
      },
      column: 'description',
      restored: 'a wandering knight',
    },
    plain: {
      action: {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_1', patch: { injectionMode: 'always' } },
      },
      column: 'injection_mode',
      restored: 'auto',
    },
  },
  lore: {
    kind: 'lore',
    table: 'lore',
    id: 'lore_1',
    create: {
      kind: 'createLore',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'lore_1',
          branchId: 'b1',
          title: 'The Ashfall',
          body: 'ash fell for a year',
          injectionMode: 'auto',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
    embedded: {
      action: {
        kind: 'updateLore',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'lore_1', patch: { body: 'ash fell for a decade' } },
      },
      column: 'body',
      restored: 'ash fell for a year',
    },
    plain: {
      action: {
        kind: 'updateLore',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'lore_1', patch: { category: 'cataclysm' } },
      },
      column: 'category',
      restored: null,
    },
  },
  thread: {
    kind: 'thread',
    table: 'threads',
    id: 'thread_1',
    create: {
      kind: 'createThread',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'thread_1',
          branchId: 'b1',
          title: 'The missing blade',
          description: 'Kael hunts for it',
          status: 'active',
          injectionMode: 'auto',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
    embedded: {
      action: {
        kind: 'updateThread',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'thread_1', patch: { description: 'Aria hunts for it' } },
      },
      column: 'description',
      restored: 'Kael hunts for it',
    },
    plain: {
      action: {
        kind: 'updateThread',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'thread_1', patch: { category: 'quest' } },
      },
      column: 'category',
      restored: null,
    },
  },
  happening: {
    kind: 'happening',
    table: 'happenings',
    id: 'hap_1',
    create: {
      kind: 'createHappening',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'hap_1',
          branchId: 'b1',
          title: 'The duel',
          description: 'Kael vs Aria',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
    embedded: {
      action: {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hap_1', patch: { title: 'The duel at dawn' } },
      },
      column: 'title',
      restored: 'The duel',
    },
    plain: {
      action: {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hap_1', patch: { category: 'combat' } },
      },
      column: 'category',
      restored: null,
    },
  },
  chapter: {
    kind: 'chapter',
    table: 'chapters',
    id: 'chap_1',
    create: {
      kind: 'createChapter',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'chap_1',
          branchId: 'b1',
          sequenceNumber: 1,
          title: 'Ashfall',
          summary: 'they fled the city',
          theme: 'loss',
          startEntryId: 'entry_1',
          endEntryId: 'entry_2',
          tokenCount: 10,
          closedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
    embedded: {
      action: {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'chap_1', patch: { summary: 'they held the gate' } },
      },
      column: 'summary',
      restored: 'they fled the city',
    },
    // A chapter embeds summary and theme, so title is plain here even though every
    // other kind embeds it.
    plain: {
      action: {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'chap_1', patch: { title: 'Ashfall Revisited' } },
      },
      column: 'title',
      restored: 'Ashfall',
    },
  },
}

const STALE_CASES: StaleCase[] = Object.values(STALE_CASES_BY_KIND)

async function undoUpdate(c: StaleCase, update: UndoCase) {
  const { db, sqlite, runInTransaction } = await createTestDb()
  const ctx = { db, runInTransaction }
  await seed(db)
  await apply(ctx, c.create, 'act_create')
  await apply(ctx, update.action, 'act_edit')
  // Stand in for the embed that ran between the edit and the undo: the vector now
  // holds the edited text and the flag reads clean.
  sqlite.exec(`UPDATE ${c.table} SET embedding_stale = 0`)
  await reverseReplayDeltas('act_edit', ctx)
  return readRow(sqlite, c.table, c.id)
}

describe('reverse-replay and embedding_stale', () => {
  it.each(STALE_CASES)('re-dirties $kind when the undo restores an embedded column', async (c) => {
    const row = await undoUpdate(c, c.embedded)
    expect(row[c.embedded.column]).toBe(c.embedded.restored)
    expect(row.embedding_stale).toBe(1)
  })

  it.each(STALE_CASES)('leaves $kind clean when the undo restores a plain column', async (c) => {
    const row = await undoUpdate(c, c.plain)
    expect(row[c.plain.column]).toBe(c.plain.restored)
    expect(row.embedding_stale).toBe(0)
  })

  it('re-dirties embedding_stale when undoing a delete of an embeddable row', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await createKnight(ctx, 'act_create')
    // The row was embedded before the delete, so its recorded flag is clean.
    sqlite.exec('UPDATE entities SET embedding_stale = 0')
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteEntity',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'char_1' },
        },
        actionId: 'act_delete',
        branchId: 'b1',
      },
      ctx,
    )
    expect(await knightRow(db)).toBeUndefined()

    await reverseReplayDeltas('act_delete', ctx)

    const row = await knightRow(db)
    expect(row.description).toBe('a wandering knight')
    expect(row.embeddingStale).toBe(1)
  })

  it('re-dirties a restored happening whose delete cascaded to its link rows', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    happeningInvolvementsStore.hydrate('b1', [])
    happeningAwarenessStore.hydrate('b1', [])
    await apply(ctx, STALE_CASES_BY_KIND.happening.create, 'act_create')
    await db.insert(happeningInvolvements).values({
      id: 'inv_1',
      branchId: 'b1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'duelist',
    })
    await db.insert(happeningAwareness).values({
      id: 'haw_1',
      branchId: 'b1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      source: 'direct',
    })
    // Embedded before the delete, so the payload records a clean flag.
    sqlite.exec('UPDATE happenings SET embedding_stale = 0')
    await apply(
      ctx,
      {
        kind: 'deleteHappening',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hap_1' },
      },
      'act_delete',
    )

    await reverseReplayDeltas('act_delete', ctx)

    const row = readRow(sqlite, 'happenings', 'hap_1')
    expect(row.title).toBe('The duel')
    expect(row.embedding_stale).toBe(1)
    // The engine strips the cascade keys off the parent row before it sets the flag,
    // so a cascade that stopped restoring children would still flip the flag.
    const involvements = await db
      .select()
      .from(happeningInvolvements)
      .where(eq(happeningInvolvements.id, 'inv_1'))
    expect(involvements.length).toBe(1)
    const awareness = await db
      .select()
      .from(happeningAwareness)
      .where(eq(happeningAwareness.id, 'haw_1'))
    expect(awareness.length).toBe(1)
    // Neither link table is embeddable, so the child arm must leave them alone.
    // Compared against the DB row, not key-wise: drizzle drops unknown keys silently,
    // so an ungated flag surfaces only as store/DB drift.
    expect(happeningInvolvementsStore.getById('inv_1')).toEqual(involvements[0])
    expect(happeningAwarenessStore.getById('haw_1')).toEqual(awareness[0])
  })
})
