import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it, vi } from 'vitest'

import { branches, deltas, entities, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { applyRedo, snapshotForRedo } from './redo'
import { register } from './registry'

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
