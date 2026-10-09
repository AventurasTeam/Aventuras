import { afterEach, describe, expect, it } from 'vitest'

import { branches, entities, stories, type EntityState, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { generationStore, resetAllStores } from '@/lib/stores'

import { commitRowSave } from './commit-row-save'
import { withKeyLock } from '../delta/key-lock'
import { rowLock } from '../delta/row-locks'
import type { PipelineAction } from '../types'

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  return { db, ctx: { db, runInTransaction } }
}

const loc = (id: string, parent: string | null): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'location',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: { parent_location_id: parent },
  createdAt: 1,
  updatedAt: 1,
})

const setParent = (id: string, parent: string): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch: { state: { parent_location_id: parent } as EntityState } },
})

const save = (build: () => PipelineAction[], ctx: Awaited<ReturnType<typeof setup>>['ctx']) =>
  commitRowSave('entity', { branchId: 'b1', rowId: 'loc_a', idPrefix: 'loc', build }, ctx)

afterEach(() => resetAllStores())

describe('commitRowSave — every refusal carries a code from the closed set', () => {
  it('reports a reversal that starts while the save waits on its lock as in-flight', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_a', null), loc('loc_b', null)])
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const held = withKeyLock(rowLock('entities')({ branchId: 'b1', id: 'loc_a' }), () => gate)
    const pending = save(() => [setParent('loc_a', 'loc_b')], ctx)
    generationStore.setReversalInProgress(true)
    release()
    await held

    expect(await pending).toMatchObject({ status: 'rejected', code: 'in-flight' })
  })

  it('passes a parent-chain refusal through with its own code', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_a', null), loc('loc_b', 'loc_a')])

    expect(await save(() => [setParent('loc_a', 'loc_b')], ctx)).toMatchObject({
      status: 'rejected',
      code: 'parent-cycle',
    })
  })

  it('reports a save of a row that is gone as not-found', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_b', null)])

    expect(await save(() => [setParent('loc_a', 'loc_b')], ctx)).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
  })

  it('reports a refusal that carries no code as failed', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_a', null)])
    const unhandled = { kind: 'noSuchAction', source: 'user_edit', payload: {} } as never

    expect(await save(() => [unhandled], ctx)).toMatchObject({
      status: 'rejected',
      code: 'failed',
    })
  })
})
