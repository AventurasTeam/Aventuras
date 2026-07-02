import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import type { Delta } from '@/lib/db'
import { branches, deltas, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { createWorkingSetStore } from '@/lib/stores'

import { applyDeltaAction } from '../apply-delta-action'
import { __resetRegistry, register, type ActionHandler, type StorePatcher } from '../registry'
import { reverseAndPruneDeltaRows, reverseReplayDeltas } from '../reverse-replay'

// Throwaway domain — raw SQL only; never in the real schema/migrations.
const fixtures = sqliteTable('fixtures', {
  id: text('id').notNull(),
  branchId: text('branch_id').notNull(),
  label: text('label').notNull(),
  createdAt: integer('created_at').notNull(),
})

type FixtureRow = { id: string; branchId: string; label: string; createdAt: number }

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    fixtureCreate: { source: 'user_edit'; payload: { row: FixtureRow } }
    fixtureUpdate: { source: 'user_edit'; payload: { branchId: string; id: string; label: string } }
    fixtureDelete: { source: 'user_edit'; payload: { branchId: string; id: string } }
  }
}

const fixtureCreateHandler: ActionHandler = (action, branchId) => {
  if (action.kind !== 'fixtureCreate')
    throw new Error(`handler/kind mismatch: expected 'fixtureCreate', got '${action.kind}'`)
  const { row } = action.payload
  if (row.branchId !== branchId)
    return { status: 'rejected', reason: `branch mismatch: ${branchId} vs ${row.branchId}` }
  return {
    status: 'ok',
    targetTable: 'fixtures',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [
      {
        sql: 'INSERT INTO fixtures (id, branch_id, label, created_at) VALUES (?, ?, ?, ?)',
        params: [row.id, row.branchId, row.label, row.createdAt],
      },
    ],
    patch: { op: 'create', id: row.id, row },
  }
}

const fixtureUpdateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'fixtureUpdate')
    throw new Error(`handler/kind mismatch: expected 'fixtureUpdate', got '${action.kind}'`)
  const { branchId: bid, id, label } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: ${branchId} vs ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(fixtures)
    .where(and(eq(fixtures.branchId, bid), eq(fixtures.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target fixtures ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'fixtures',
    targetId: id,
    op: 'update',
    // label has no columnSchema → reverse-replay restores it as a whole scalar.
    undoPayload: { label: current.label },
    ops: [
      ctx.db
        .update(fixtures)
        .set({ label })
        .where(and(eq(fixtures.branchId, bid), eq(fixtures.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: { label } },
  }
}

const fixtureDeleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'fixtureDelete')
    throw new Error(`handler/kind mismatch: expected 'fixtureDelete', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: ${branchId} vs ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(fixtures)
    .where(and(eq(fixtures.branchId, bid), eq(fixtures.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target fixtures ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'fixtures',
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
        .delete(fixtures)
        .where(and(eq(fixtures.branchId, bid), eq(fixtures.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

type TestCtx = {
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
  store: ReturnType<typeof createWorkingSetStore<FixtureRow>>
}

async function setup(patcher?: StorePatcher): Promise<TestCtx> {
  // vitest.setup.ts registered the real domains process-globally; reset so only the fixture domain is live.
  __resetRegistry()
  const { db, sqlite, runInTransaction } = await createTestDb()

  // fixtures table lives outside the migrations; create it via raw SQL.
  sqlite.exec(
    'CREATE TABLE fixtures (id TEXT NOT NULL, branch_id TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (branch_id, id))',
  )

  // Seed story + branch (FK parents for deltas).
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })

  const store = createWorkingSetStore<FixtureRow>()

  register({
    table: 'fixtures',
    descriptor: { table: fixtures, idCol: fixtures.id, branchCol: fixtures.branchId },
    columnSchemas: {},
    handlers: {
      fixtureCreate: fixtureCreateHandler,
      fixtureUpdate: fixtureUpdateHandler,
      fixtureDelete: fixtureDeleteHandler,
    },
    patcher: patcher ?? ((branchId, p) => store.patch(branchId, p)),
  })

  return { db, runInTransaction, store }
}

const ROW: FixtureRow = { id: 'f1', branchId: 'b1', label: 'hello', createdAt: 1 }

describe('fixture domain self-registration + roundtrip (AC5)', () => {
  it('full forward CRUD roundtrip: create/update/delete each update both DB and store', async () => {
    const { db, runInTransaction, store } = await setup()
    const ctx = { db, runInTransaction }
    store.hydrate('b1', [])

    await applyDeltaAction(
      {
        action: { kind: 'fixtureCreate', source: 'user_edit', payload: { row: ROW } },
        actionId: 'act_create',
        branchId: 'b1',
      },
      ctx,
    )
    const [createdDb] = await db.select().from(fixtures).where(eq(fixtures.id, 'f1'))
    expect(createdDb.label).toBe('hello')
    expect(store.getRows().get('f1')?.label).toBe('hello')

    await applyDeltaAction(
      {
        action: {
          kind: 'fixtureUpdate',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'f1', label: 'world' },
        },
        actionId: 'act_update',
        branchId: 'b1',
      },
      ctx,
    )
    const [updatedDb] = await db.select().from(fixtures).where(eq(fixtures.id, 'f1'))
    expect(updatedDb.label).toBe('world')
    expect(store.getRows().get('f1')?.label).toBe('world')

    await applyDeltaAction(
      {
        action: {
          kind: 'fixtureDelete',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'f1' },
        },
        actionId: 'act_delete',
        branchId: 'b1',
      },
      ctx,
    )
    expect((await db.select().from(fixtures).where(eq(fixtures.id, 'f1'))).length).toBe(0)
    expect(store.getRows().has('f1')).toBe(false)
  })

  it('reverse-replay undoes a freshly-registered domain action end-to-end', async () => {
    const { db, runInTransaction, store } = await setup()
    const ctx = { db, runInTransaction }
    store.hydrate('b1', [])

    await applyDeltaAction(
      {
        action: { kind: 'fixtureCreate', source: 'user_edit', payload: { row: ROW } },
        actionId: 'act_undo_me',
        branchId: 'b1',
      },
      ctx,
    )
    expect(store.getRows().get('f1')?.label).toBe('hello')

    const reversed = await reverseReplayDeltas('act_undo_me', ctx)
    // Count proves reverse-replay found + processed the delta (didn't short-circuit to 0).
    expect(reversed).toBe(1)

    expect((await db.select().from(fixtures).where(eq(fixtures.id, 'f1'))).length).toBe(0)
    expect(store.getRows().has('f1')).toBe(false)
  })

  it('rejects a branch-mismatch payload without writing a row or a delta', async () => {
    const { db, runInTransaction, store } = await setup()
    store.hydrate('b1', [])

    // Delta branch is b1, but the payload row claims b2. Every arm guards this so
    // reverse-replay can't be aimed at the wrong branch's row; assert it short-circuits
    // before any write.
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'fixtureCreate',
          source: 'user_edit',
          payload: { row: { ...ROW, branchId: 'b2' } },
        },
        actionId: 'act_mismatch',
        branchId: 'b1',
      },
      { db, runInTransaction },
    )

    expect(result.status).toBe('rejected')
    expect((await db.select().from(fixtures)).length).toBe(0)
    expect((await db.select().from(deltas)).length).toBe(0)
    expect(store.getRows().size).toBe(0)
  })

  it('reverse-and-prune: post-commit patcher failure reports committed; DB stays reversed', async () => {
    // Throw only on the reverse (op:'delete') patch so the forward create still commits.
    const { db, runInTransaction } = await setup((_branchId, p) => {
      if (p.op === 'delete') throw new Error('patcher boom')
    })
    const ctx = { db, runInTransaction }

    await applyDeltaAction(
      {
        action: { kind: 'fixtureCreate', source: 'user_edit', payload: { row: ROW } },
        actionId: 'act_prune',
        branchId: 'b1',
      },
      ctx,
    )

    const rows = (await db.select().from(deltas).where(eq(deltas.actionId, 'act_prune'))) as Delta[]
    await expect(reverseAndPruneDeltaRows(rows, ctx)).rejects.toMatchObject({
      name: 'DeltaReplayError',
      message: 'Post-commit patch sync failed',
      committed: true,
    })

    // Reversal + prune committed before the patcher threw.
    expect((await db.select().from(fixtures).where(eq(fixtures.id, 'f1'))).length).toBe(0)
    expect((await db.select().from(deltas).where(eq(deltas.actionId, 'act_prune'))).length).toBe(0)
  })
})
