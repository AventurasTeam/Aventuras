import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { branches, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { createWorkingSetStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { __resetRegistry, register, type ActionHandler } from './registry'
import { reverseReplayDeltas } from './reverse-replay'

// Throwaway domain — raw SQL only; never in the real schema/migrations.
const widgets = sqliteTable('widgets', {
  id: text('id').notNull(),
  branchId: text('branch_id').notNull(),
  label: text('label').notNull(),
  createdAt: integer('created_at').notNull(),
})

type WidgetRow = { id: string; branchId: string; label: string; createdAt: number }

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    widgetCreate: { source: 'user_edit'; payload: { row: WidgetRow } }
    widgetUpdate: { source: 'user_edit'; payload: { branchId: string; id: string; label: string } }
    widgetDelete: { source: 'user_edit'; payload: { branchId: string; id: string } }
  }
}

const widgetCreateHandler: ActionHandler = (_action, branchId) => {
  if (_action.kind !== 'widgetCreate')
    throw new Error(`handler/kind mismatch: expected 'widgetCreate', got '${_action.kind}'`)
  const { row } = _action.payload
  if (row.branchId !== branchId)
    return { status: 'rejected', reason: `branch mismatch: ${branchId} vs ${row.branchId}` }
  return {
    status: 'ok',
    targetTable: 'widgets',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [
      {
        sql: 'INSERT INTO widgets (id, branch_id, label, created_at) VALUES (?, ?, ?, ?)',
        params: [row.id, row.branchId, row.label, row.createdAt],
      },
    ],
    patch: { op: 'create', id: row.id, row },
  }
}

const widgetUpdateHandler: ActionHandler = async (_action, branchId, ctx) => {
  if (_action.kind !== 'widgetUpdate')
    throw new Error(`handler/kind mismatch: expected 'widgetUpdate', got '${_action.kind}'`)
  const { branchId: bid, id, label } = _action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: ${branchId} vs ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(widgets)
    .where(and(eq(widgets.branchId, bid), eq(widgets.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target widgets ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'widgets',
    targetId: id,
    op: 'update',
    // label has no columnSchema → reverse-replay restores it as a whole scalar.
    undoPayload: { label: current.label },
    ops: [
      ctx.db
        .update(widgets)
        .set({ label })
        .where(and(eq(widgets.branchId, bid), eq(widgets.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: { label } },
  }
}

const widgetDeleteHandler: ActionHandler = async (_action, branchId, ctx) => {
  if (_action.kind !== 'widgetDelete')
    throw new Error(`handler/kind mismatch: expected 'widgetDelete', got '${_action.kind}'`)
  const { branchId: bid, id } = _action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: ${branchId} vs ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(widgets)
    .where(and(eq(widgets.branchId, bid), eq(widgets.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target widgets ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'widgets',
    targetId: id,
    op: 'delete',
    undoPayload: {
      id: current.id,
      branchId: current.branchId,
      label: current.label,
      createdAt: current.createdAt,
    },
    ops: [
      ctx.db
        .delete(widgets)
        .where(and(eq(widgets.branchId, bid), eq(widgets.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

type TestCtx = {
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
  store: ReturnType<typeof createWorkingSetStore<WidgetRow>>
}

async function setup(): Promise<TestCtx> {
  // vitest.setup.ts registered the real domains process-globally; reset so only the fixture domain is live.
  __resetRegistry()
  const { db, sqlite, runInTransaction } = await createTestDb()

  // widgets table lives outside the migrations; create it via raw SQL.
  sqlite.exec(
    'CREATE TABLE widgets (id TEXT NOT NULL, branch_id TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL)',
  )

  // Seed story + branches (FK parents for deltas).
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'alt', createdAt: 1 })

  const store = createWorkingSetStore<WidgetRow>()

  register({
    table: 'widgets',
    descriptor: { table: widgets, idCol: widgets.id, branchCol: widgets.branchId },
    columnSchemas: {},
    handlers: {
      widgetCreate: widgetCreateHandler,
      widgetUpdate: widgetUpdateHandler,
      widgetDelete: widgetDeleteHandler,
    },
    patcher: (branchId, p) => store.patch(branchId, p),
  })

  return { db, runInTransaction, store }
}

const ROW: WidgetRow = { id: 'w1', branchId: 'b1', label: 'hello', createdAt: 1 }

describe('store-mirror contract (AC6)', () => {
  it('held-branch forward mirror: create/update/delete all patch the store', async () => {
    const { db, runInTransaction, store } = await setup()
    const ctx = { db, runInTransaction }
    store.hydrate('b1', [])

    await applyDeltaAction(
      {
        action: { kind: 'widgetCreate', source: 'user_edit', payload: { row: ROW } },
        actionId: 'act_1',
        branchId: 'b1',
      },
      ctx,
    )
    const [dbRow] = await db.select().from(widgets).where(eq(widgets.id, 'w1'))
    expect(dbRow.label).toBe('hello')
    expect(store.getRows().get('w1')?.label).toBe('hello')

    await applyDeltaAction(
      {
        action: {
          kind: 'widgetUpdate',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'w1', label: 'world' },
        },
        actionId: 'act_2',
        branchId: 'b1',
      },
      ctx,
    )
    const [updatedRow] = await db.select().from(widgets).where(eq(widgets.id, 'w1'))
    expect(updatedRow.label).toBe('world')
    expect(store.getRows().get('w1')?.label).toBe('world')

    await applyDeltaAction(
      {
        action: {
          kind: 'widgetDelete',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'w1' },
        },
        actionId: 'act_3',
        branchId: 'b1',
      },
      ctx,
    )
    expect((await db.select().from(widgets).where(eq(widgets.id, 'w1'))).length).toBe(0)
    expect(store.getRows().has('w1')).toBe(false)
  })

  it('reverse of create un-creates the row and removes it from the store', async () => {
    const { db, runInTransaction, store } = await setup()
    const ctx = { db, runInTransaction }
    store.hydrate('b1', [])

    await applyDeltaAction(
      {
        action: { kind: 'widgetCreate', source: 'user_edit', payload: { row: ROW } },
        actionId: 'act_x',
        branchId: 'b1',
      },
      ctx,
    )
    expect(store.getRows().get('w1')?.label).toBe('hello')

    await reverseReplayDeltas('act_x', ctx)

    const rows = await db.select().from(widgets).where(eq(widgets.id, 'w1'))
    expect(rows.length).toBe(0)
    expect(store.getRows().has('w1')).toBe(false)
  })

  it('reverse of update restores the prior label in the store', async () => {
    const { db, runInTransaction, store } = await setup()
    const ctx = { db, runInTransaction }
    store.hydrate('b1', [])

    await applyDeltaAction(
      {
        action: { kind: 'widgetCreate', source: 'user_edit', payload: { row: ROW } },
        actionId: 'act_base',
        branchId: 'b1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'widgetUpdate',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'w1', label: 'world' },
        },
        actionId: 'act_upd',
        branchId: 'b1',
      },
      ctx,
    )
    expect(store.getRows().get('w1')?.label).toBe('world')

    await reverseReplayDeltas('act_upd', ctx)

    const [dbRow] = await db.select().from(widgets).where(eq(widgets.id, 'w1'))
    expect(dbRow.label).toBe('hello')
    expect(store.getRows().get('w1')?.label).toBe('hello')
  })

  it('non-held-branch no-op: SQLite write succeeds but store is untouched', async () => {
    const { db, runInTransaction, store } = await setup()
    const ctx = { db, runInTransaction }
    // Store is loaded for b1; the action targets b2.
    store.hydrate('b1', [])

    const b2Row: WidgetRow = { id: 'w2', branchId: 'b2', label: 'other', createdAt: 1 }
    await applyDeltaAction(
      {
        action: { kind: 'widgetCreate', source: 'user_edit', payload: { row: b2Row } },
        actionId: 'act_b2',
        branchId: 'b2',
      },
      ctx,
    )

    const [dbRow] = await db.select().from(widgets).where(eq(widgets.id, 'w2'))
    expect(dbRow.label).toBe('other')

    // Patcher branch-guards: store loaded for b1, patch arrived for b2 → no-op.
    expect(store.getRows().has('w2')).toBe(false)
    expect(store.getRows().size).toBe(0)
  })
})
