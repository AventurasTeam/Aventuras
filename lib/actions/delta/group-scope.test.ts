import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { branches, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { createWorkingSetStore } from '@/lib/stores'

import { applyDeltaAction, applyDeltaActionGroup } from './apply-delta-action'
import { __resetRegistry, createdKey, register, type GroupScope } from './registry'

const scopeRows = sqliteTable('group_scope_rows', {
  id: text('id').notNull(),
  branchId: text('branch_id').notNull(),
})

declare module '@/lib/actions/action-map' {
  interface TestPipelineActionMap {
    groupScopeCreate: { source: 'user_edit'; payload: { id: string } }
    groupScopeDelete: { source: 'user_edit'; payload: { id: string } }
    groupScopeProbe: { source: 'user_edit'; payload: { id: string } }
  }
}

async function setup() {
  __resetRegistry()
  const { db, sqlite, runInTransaction } = await createTestDb()
  sqlite.exec('CREATE TABLE group_scope_rows (id TEXT NOT NULL, branch_id TEXT NOT NULL)')
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })

  const seen: (GroupScope | undefined)[] = []
  const store = createWorkingSetStore<{ id: string }>()
  store.hydrate('b1', [{ id: 'child_1' }])
  register({
    table: 'group_scope_rows',
    descriptor: { table: scopeRows, idCol: scopeRows.id, branchCol: scopeRows.branchId },
    columnSchemas: {},
    handlers: {
      groupScopeCreate: (action) => {
        if (action.kind !== 'groupScopeCreate') throw new Error('kind')
        return {
          status: 'ok',
          targetTable: 'group_scope_rows',
          targetId: action.payload.id,
          op: 'create',
          undoPayload: null,
          ops: [
            {
              sql: 'INSERT INTO group_scope_rows (id, branch_id) VALUES (?, ?)',
              params: [action.payload.id, 'b1'],
            },
          ],
          patch: null,
        }
      },
      groupScopeDelete: (action) => {
        if (action.kind !== 'groupScopeDelete') throw new Error('kind')
        return {
          status: 'ok',
          targetTable: 'group_scope_rows',
          targetId: action.payload.id,
          op: 'delete',
          undoPayload: { id: action.payload.id, group_scope_children: [{ id: 'child_1' }] },
          ops: [
            {
              sql: 'DELETE FROM group_scope_rows WHERE id = ? AND branch_id = ?',
              params: [action.payload.id, 'b1'],
            },
          ],
          patch: null,
        }
      },
      groupScopeProbe: (action, _branchId, _ctx, group) => {
        if (action.kind !== 'groupScopeProbe') throw new Error('kind')
        seen.push(group)
        return { status: 'rejected', reason: 'probe only', code: 'noop' }
      },
    },
    cascade: {
      tables: ['group_scope_children'],
      run: async () => ({ ops: [], children: { group_scope_children: [] } }),
    },
  })
  register({
    table: 'group_scope_children',
    descriptor: { table: scopeRows, idCol: scopeRows.id, branchCol: scopeRows.branchId },
    columnSchemas: {},
    handlers: {},
    patcher: (branchId, patch) => store.patch(branchId, patch),
  })
  return { ctx: { db, runInTransaction }, seen, store }
}

describe('applyDeltaActionGroup — group scope and cascade patches', () => {
  it('shows each handler the rows created earlier in its group', async () => {
    const { ctx, seen } = await setup()

    const result = await applyDeltaActionGroup(
      [
        { kind: 'groupScopeCreate', source: 'user_edit', payload: { id: 'row_1' } },
        { kind: 'groupScopeProbe', source: 'user_edit', payload: { id: 'row_1' } },
      ],
      { actionId: 'act_1', branchId: 'b1' },
      ctx,
    )

    expect(result).toEqual({ status: 'ok' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.created.has(createdKey('group_scope_rows', 'row_1'))).toBe(true)
  })

  it('patches the children a delete captured in its payload out of their store', async () => {
    const { ctx, store } = await setup()

    const result = await applyDeltaActionGroup(
      [{ kind: 'groupScopeDelete', source: 'user_edit', payload: { id: 'row_1' } }],
      { actionId: 'act_1', branchId: 'b1' },
      ctx,
    )

    expect(result).toEqual({ status: 'ok' })
    expect(store.getRows().has('child_1')).toBe(false)
  })

  it('patches captured children on the single-action path too, which has no group scope', async () => {
    const { ctx, seen, store } = await setup()

    const deleted = await applyDeltaAction(
      {
        action: { kind: 'groupScopeDelete', source: 'user_edit', payload: { id: 'row_1' } },
        actionId: 'act_1',
        branchId: 'b1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: { kind: 'groupScopeProbe', source: 'user_edit', payload: { id: 'row_1' } },
        actionId: 'act_2',
        branchId: 'b1',
      },
      ctx,
    )

    expect(deleted.status).toBe('ok')
    expect(store.getRows().has('child_1')).toBe(false)
    expect(seen).toEqual([undefined])
  })
})
