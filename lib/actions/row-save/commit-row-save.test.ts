import { afterEach, describe, expect, it, vi } from 'vitest'

import { branches, entities, stories, type EntityState, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { generationStore, resetAllStores } from '@/lib/stores'
import type { PlaceSaveRefusal } from '@/lib/world'

import { commitRowSave, flatRowSaveResult } from './commit-row-save'
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

afterEach(() => {
  resetAllStores()
  vi.restoreAllMocks()
})

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

describe('commitRowSave — place rules', () => {
  const REFUSAL: PlaceSaveRefusal = {
    code: 'retired-place',
    field: 'currentLocationId',
    place: { id: 'loc_sunk', name: 'Saltmere' },
  }

  it('returns a refusal with its code and detail, never building or writing', async () => {
    const { ctx } = await setup()
    const build = vi.fn(() => [] as PipelineAction[])
    const result = await commitRowSave(
      'entity',
      { branchId: 'b1', rowId: 'char_1', idPrefix: 'char', refuse: () => REFUSAL, build },
      ctx,
    )
    expect(result).toEqual({
      status: 'rejected',
      reason: 'place rule: retired-place',
      code: 'retired-place',
      refusal: REFUSAL,
    })
    expect(build).not.toHaveBeenCalled()
  })

  it('logs a place rule that throws as a failed Save, and rethrows', async () => {
    const { ctx } = await setup()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const refuse = () => {
      throw new Error('broken rule')
    }
    await expect(
      commitRowSave(
        'entity',
        { branchId: 'b1', rowId: 'char_1', idPrefix: 'char', refuse, build: () => [] },
        ctx,
      ),
    ).rejects.toThrow('broken rule')
    expect(error).toHaveBeenCalledWith('action_layer.entity_save_failed', {
      branchId: 'b1',
      id: 'char_1',
      create: false,
      error: 'broken rule',
    })
  })

  it('checks the gate before the place rules', async () => {
    const { ctx } = await setup()
    vi.spyOn(generationStore, 'isUserEditBlocked').mockReturnValue(true)
    const refuse = vi.fn(() => REFUSAL)
    const result = await commitRowSave(
      'entity',
      { branchId: 'b1', rowId: 'char_1', idPrefix: 'char', refuse, build: () => [] },
      ctx,
    )
    expect(result).toMatchObject({ code: 'in-flight' })
    expect(refuse).not.toHaveBeenCalled()
  })

  it("passes the create handler's retired-parent refusal through with its own code", async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([{ ...loc('loc_sunk', null), status: 'retired' }])
    const create: PipelineAction = {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: loc('loc_new', 'loc_sunk') },
    }
    expect(
      await commitRowSave(
        'entity',
        { branchId: 'b1', rowId: null, idPrefix: 'loc', build: () => [create] },
        ctx,
      ),
    ).toMatchObject({ status: 'rejected', code: 'retired-parent' })
  })
})

describe('flatRowSaveResult', () => {
  it('reports a place-rule code as a failure', () => {
    for (const code of ['story-inside', 'retired-parent', 'retired-place'] as const)
      expect(flatRowSaveResult({ status: 'rejected', reason: 'r', code })).toEqual({
        status: 'rejected',
        reason: 'r',
        code: 'failed',
      })
  })

  it('reports a parent code as a failure and passes every other result through', () => {
    for (const code of ['parent-cycle', 'parent-chain-broken'] as const)
      expect(flatRowSaveResult({ status: 'rejected', reason: 'r', code })).toEqual({
        status: 'rejected',
        reason: 'r',
        code: 'failed',
      })
    for (const code of ['in-flight', 'not-found', 'failed'] as const)
      expect(flatRowSaveResult({ status: 'rejected', reason: 'r', code })).toEqual({
        status: 'rejected',
        reason: 'r',
        code,
      })
    expect(flatRowSaveResult({ status: 'ok', id: 'thr_1' })).toEqual({ status: 'ok', id: 'thr_1' })
  })
})
