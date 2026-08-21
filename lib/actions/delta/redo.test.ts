import { desc, eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  deltas,
  entities,
  stories,
  storyEntries,
  type Delta,
  type NewEntity,
  type VecTargetKind,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, entriesStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { applyRedo, snapshotForRedo } from './redo'
import { register } from './registry'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import type { PipelineAction } from '../types'

// Throwaway domain (raw SQL only) with a unique table name so registering it
// alongside the real domains can't disturb the entities-based tests above.
const phantoms = sqliteTable('redo_phantoms', {
  id: text('id').notNull(),
  branchId: text('branch_id').notNull(),
  label: text('label'),
})

describe('snapshotForRedo / applyRedo', () => {
  it('round-trips an update delta: captures pre-undo state, then restores it on redo', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(entities).values({
      id: 'ent_1',
      branchId: 'b1',
      kind: 'character',
      name: 'Aria',
      description: 'a knight',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })

    const deltaRow = {
      id: 'd1',
      branchId: 'b1',
      actionId: 'act_1',
      op: 'update' as const,
      targetTable: 'entities',
      targetId: 'ent_1',
      entryId: null,
      source: 'user_edit' as const,
      undoPayload: { name: 'Old Name' },
      logPosition: 1,
      encodingVersion: 1,
      createdAt: Date.now(),
    }

    // snapshotForRedo must run BEFORE the undo reversal, capturing current ('Aria').
    const snapshot = await snapshotForRedo([deltaRow], ctx)

    // Simulate the undo having applied the delta's undo_payload (name -> 'Old Name').
    await db.update(entities).set({ name: 'Old Name' }).where(eq(entities.id, 'ent_1'))

    // Redo must restore the pre-undo state ('Aria'), not the undo_payload's value.
    await applyRedo(snapshot, ctx)
    const [row] = await db.select().from(entities).where(eq(entities.id, 'ent_1'))
    expect(row?.name).toBe('Aria')

    // applyRedo re-inserts the original delta row so a later undo can reverse the redo.
    const [deltaAfter] = await db.select().from(deltas).where(eq(deltas.id, 'd1'))
    expect(deltaAfter?.actionId).toBe('act_1')
    expect(deltaAfter?.targetId).toBe('ent_1')
  })

  // A null snapshot means the row was already gone; re-inserting its delta would
  // leave a later CTRL-Z reversing a row this redo never wrote.
  it('writes no delta for a snapshot that restores nothing', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })

    const deltaRow = {
      id: 'd_missing',
      branchId: 'b1',
      actionId: 'act_1',
      op: 'update' as const,
      targetTable: 'entities',
      targetId: 'ent_absent',
      entryId: null,
      source: 'user_edit' as const,
      undoPayload: { name: 'Old Name' },
      logPosition: 1,
      encodingVersion: 1,
      createdAt: Date.now(),
    }

    await applyRedo([{ delta: deltaRow, rowBeforeUndo: null }], ctx)

    const rows = await db.select().from(deltas).where(eq(deltas.id, 'd_missing'))
    expect(rows).toHaveLength(0)
  })

  it('round-trips a delete delta: redo re-applies the original delete', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })

    const fullRow = {
      id: 'ent_2',
      branchId: 'b1',
      kind: 'character' as const,
      name: 'Bram',
      description: 'a scout',
      status: 'active' as const,
      injectionMode: 'auto' as const,
      createdAt: 1,
      updatedAt: 1,
    }
    await db.insert(entities).values(fullRow)
    // The original action already deleted the row — the delta log records that,
    // so the live row is absent by the time undo/redo ever runs.
    await db.delete(entities).where(eq(entities.id, 'ent_2'))

    const deleteDelta = {
      id: 'd2',
      branchId: 'b1',
      actionId: 'act_2',
      op: 'delete' as const,
      targetTable: 'entities',
      targetId: 'ent_2',
      entryId: null,
      source: 'user_edit' as const,
      undoPayload: fullRow,
      logPosition: 2,
      encodingVersion: 1,
      createdAt: Date.now(),
    }

    // snapshotForRedo runs before the undo's re-insertion — the row is still absent.
    const snapshot = await snapshotForRedo([deleteDelta], ctx)

    // Simulate the undo's delete-branch reversal (buildUndoOps): re-insert from undo_payload.
    await db.insert(entities).values(deleteDelta.undoPayload)

    // Redo must re-apply the original delete.
    await applyRedo(snapshot, ctx)
    const [row] = await db.select().from(entities).where(eq(entities.id, 'ent_2'))
    expect(row).toBeUndefined()

    const [deltaAfter] = await db.select().from(deltas).where(eq(deltas.id, 'd2'))
    expect(deltaAfter?.actionId).toBe('act_2')
    expect(deltaAfter?.targetId).toBe('ent_2')
  })

  it('skips the patcher for a null-rowBeforeUndo create, but still patches a delete in the same batch', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    // redo_phantoms lives outside the migrations; create it via raw SQL.
    sqlite.exec(
      'CREATE TABLE redo_phantoms (id TEXT NOT NULL, branch_id TEXT NOT NULL, label TEXT, PRIMARY KEY (branch_id, id))',
    )
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })

    const patcher = vi.fn()
    register({
      table: 'redo_phantoms',
      descriptor: { table: phantoms, idCol: phantoms.id, branchCol: phantoms.branchId },
      columnSchemas: {},
      handlers: {},
      patcher,
    })

    const baseDelta = {
      branchId: 'b1',
      actionId: 'act_phantom',
      targetTable: 'redo_phantoms',
      entryId: null,
      source: 'user_edit' as const,
      undoPayload: null,
      encodingVersion: 1,
      createdAt: Date.now(),
    }
    const createDelta = {
      ...baseDelta,
      id: 'd_create',
      op: 'create' as const,
      targetId: 'ph_create',
      logPosition: 10,
    }
    const deleteDelta = {
      ...baseDelta,
      id: 'd_delete',
      op: 'delete' as const,
      targetId: 'ph_delete',
      logPosition: 11,
    }

    // A null rowBeforeUndo means snapshotForRedo found no matching row: applyRedo
    // must write nothing to the DB for create/update, and must NOT patch the store.
    await applyRedo(
      [
        { delta: createDelta, rowBeforeUndo: null },
        { delta: deleteDelta, rowBeforeUndo: null },
      ],
      ctx,
    )

    // No phantom create patch for the null-row create.
    expect(patcher).not.toHaveBeenCalledWith('b1', expect.objectContaining({ id: 'ph_create' }))
    // Delete always patches regardless of rowBeforeUndo — proving the skip is selective.
    expect(patcher).toHaveBeenCalledWith('b1', { op: 'delete', id: 'ph_delete' })
  })
})

afterEach(() => {
  entitiesStore.__reset()
  entriesStore.__reset()
})

type Ctx = {
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
}

async function seed(db: Ctx['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
}

async function apply(ctx: Ctx, action: PipelineAction, actionId: string) {
  const res = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (res.status === 'rejected') throw new Error(`${action.kind} rejected: ${res.reason}`)
}

async function undoOf(ctx: Ctx, actionId: string) {
  const rows = (await ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
  const snapshot = await snapshotForRedo(rows, ctx)
  await reverseAndPruneDeltaRows(rows, ctx)
  return snapshot
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

// `column` is the SQL column the update moves; `created` / `forward` its values
// either side. Per kind, so a lore or chapter redo can't pass on entity's columns.
type RedoCase = {
  table: string
  id: string
  create: PipelineAction
  update: PipelineAction
  column: string
  created: unknown
  forward: unknown
}

const ENTITY_CASE: RedoCase = {
  table: 'entities',
  id: 'char_1',
  create: { kind: 'createEntity', source: 'user_edit', payload: { entry: KNIGHT } },
  update: {
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id: 'char_1', patch: { description: 'a retired knight' } },
  },
  column: 'description',
  created: 'a wandering knight',
  forward: 'a retired knight',
}

// Keyed by kind, not an array: the Record is what makes a sixth kind fail to
// compile rather than slip in uncovered (the shape reverse-replay.test.ts uses).
const CASES_BY_KIND: Record<VecTargetKind, RedoCase> = {
  entity: ENTITY_CASE,
  lore: {
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
    update: {
      kind: 'updateLore',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'lore_1', patch: { body: 'ash fell for a decade' } },
    },
    column: 'body',
    created: 'ash fell for a year',
    forward: 'ash fell for a decade',
  },
  chapter: {
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
    update: {
      kind: 'updateChapter',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'chap_1', patch: { summary: 'they held the gate' } },
    },
    column: 'summary',
    created: 'they fled the city',
    forward: 'they held the gate',
  },
  thread: {
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
    update: {
      kind: 'updateThread',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'thread_1', patch: { description: 'Aria hunts for it' } },
    },
    column: 'description',
    created: 'Kael hunts for it',
    forward: 'Aria hunts for it',
  },
  happening: {
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
    update: {
      kind: 'updateHappening',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'hap_1', patch: { title: 'The duel at dawn' } },
    },
    column: 'title',
    created: 'The duel',
    forward: 'The duel at dawn',
  },
}

const CASES: RedoCase[] = Object.values(CASES_BY_KIND)

async function redoUpdate(c: RedoCase) {
  const { db, sqlite, runInTransaction } = await createTestDb()
  const ctx = { db, runInTransaction }
  await seed(db)
  await apply(ctx, c.create, 'act_create')
  await apply(ctx, c.update, 'act_edit')
  // Stand in for the drain that embedded the forward text between edit and undo.
  sqlite.exec(`UPDATE ${c.table} SET embedding_stale = 0`)
  const snapshot = await undoOf(ctx, 'act_edit')
  // ...and for the drain that re-embedded the restored text between undo and redo,
  // without which the flag would still read 1 from the undo and prove nothing.
  sqlite.exec(`UPDATE ${c.table} SET embedding_stale = 0`)
  await applyRedo(snapshot, ctx)
  return readRow(sqlite, c.table, c.id)
}

describe('applyRedo and embedding_stale', () => {
  it.each(CASES)('re-dirties $table when redoing an update', async (c) => {
    const row = await redoUpdate(c)
    expect(row[c.column]).toBe(c.forward)
    expect(row.embedding_stale).toBe(1)
  })

  it.each(CASES)('re-dirties $table when redoing a create', async (c) => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await apply(ctx, c.create, 'act_create')
    // The created row was embedded before the undo removed it.
    sqlite.exec(`UPDATE ${c.table} SET embedding_stale = 0`)
    const snapshot = await undoOf(ctx, 'act_create')
    expect(() => readRow(sqlite, c.table, c.id)).toThrow()

    await applyRedo(snapshot, ctx)
    const row = readRow(sqlite, c.table, c.id)
    expect(row[c.column]).toBe(c.created)
    expect(row.embedding_stale).toBe(1)
  })

  it('mirrors the re-dirtied flag into the working-set store', async () => {
    entitiesStore.hydrate('b1', [])
    const row = await redoUpdate(ENTITY_CASE)
    expect(row.embedding_stale).toBe(1)
    expect(entitiesStore.getById('char_1')?.embeddingStale).toBe(1)
  })

  it('redoes a story_entries update, which has no embedding_stale column', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const entry = {
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'opening' as const,
      content: 'once upon a time',
      chapterId: null,
      metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
      createdAt: 1,
    }
    await db.insert(storyEntries).values(entry)
    entriesStore.hydrate('b1', [entry])
    const forward = { sceneEntities: [], currentLocationId: null, worldTime: 9 }
    await apply(
      ctx,
      {
        kind: 'updateStoryEntryMetadata',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'e1', metadata: forward },
      },
      'act_edit',
    )
    const snapshot = await undoOf(ctx, 'act_edit')

    await applyRedo(snapshot, ctx)
    const [row] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'e1'))
    expect(row.metadata).toEqual(forward)
    // Drizzle drops a key the table has no column for, so an ungated force shows
    // up only here — as a phantom column merged into the held-branch store row.
    expect(entriesStore.getById('e1')).not.toHaveProperty('embeddingStale')
  })

  it('writes nothing for a null-rowBeforeUndo create on an embeddable table', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    entitiesStore.hydrate('b1', [])

    await applyRedo(
      [
        {
          delta: {
            id: 'd_null',
            branchId: 'b1',
            actionId: 'act_null',
            op: 'create',
            targetTable: 'entities',
            targetId: 'char_1',
            entryId: null,
            source: 'user_edit',
            undoPayload: null,
            logPosition: 1,
            encodingVersion: 1,
            createdAt: 1,
          },
          rowBeforeUndo: null,
        },
      ],
      ctx,
    )

    expect(() => readRow(sqlite, 'entities', 'char_1')).toThrow()
    expect(entitiesStore.getById('char_1')).toBeUndefined()
  })

  it('leaves a redone delete deleted', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await apply(ctx, ENTITY_CASE.create, 'act_create')
    sqlite.exec('UPDATE entities SET embedding_stale = 0')
    await apply(
      ctx,
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId: 'b1', id: 'char_1' } },
      'act_delete',
    )
    const snapshot = await undoOf(ctx, 'act_delete')
    expect(readRow(sqlite, 'entities', 'char_1').embedding_stale).toBe(1)

    await applyRedo(snapshot, ctx)
    expect(() => readRow(sqlite, 'entities', 'char_1')).toThrow()
  })
})
