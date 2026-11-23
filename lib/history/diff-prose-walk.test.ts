import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction, type PipelineAction } from '@/lib/actions'
import {
  branches,
  deltas,
  entities,
  stories,
  type DbCtx,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { resetAllStores } from '@/lib/stores'

import { diffProse } from './diff-prose'
import { walkTarget } from './diff-walk'

// The renderer fed by the real walk: a column group's members the payload lacks come from the
// walk's `new`, so a merge's re-point still reads as a flag change.

type TestDb = Awaited<ReturnType<typeof createTestDb>>

let t: TestDb
let ctx: DbCtx

beforeEach(async () => {
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await t.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await t.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })
})

afterEach(() => {
  resetAllStores()
})

const entity = (id: string, name: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const act = async (actionId: string, action: PipelineAction): Promise<Delta> => {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
  const rows = (await t.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, 'b1'), eq(deltas.actionId, actionId)))
    .orderBy(asc(deltas.logPosition))) as Delta[]
  return rows[0]
}

const updateEntity = (id: string, patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch },
})

describe('diffProse — fed by the walk', () => {
  it('reads a merge re-point of a collision flag, the old partner deleted', async () => {
    await t.db.insert(entities).values([
      entity('char_kael_old', 'Kael'),
      entity('char_kael', 'Kael'),
      entity('char_ward', 'Ward', {
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_kael_old',
        nameCollisionReason: 'duplicate',
      }),
    ])
    const repoint = await act(
      'act_1',
      updateEntity('char_ward', { nameCollisionPartnerId: 'char_kael' }),
    )
    await act('act_2', {
      kind: 'deleteEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_kael_old' },
    })
    expect(repoint.undoPayload).toStrictEqual({ nameCollisionPartnerId: 'char_kael_old' })

    const entry = (await walkTarget(t.db, [repoint])).entries.get(repoint.id)
    if (entry === undefined) throw new Error('the walk resolved no entry for the re-point')

    expect(
      diffProse(entry, {
        table: 'entities',
        side: null,
        liveName: (id) => (id === 'char_kael' ? 'Kael' : null),
        entryLabel: () => null,
      }),
    ).toBe('Collision flag: Kael (deleted) → Kael')
  })
})
