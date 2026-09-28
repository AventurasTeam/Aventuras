import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  entities,
  happenings,
  happeningInvolvements,
  stories,
  type NewHappeningInvolvement,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningInvolvementsStore } from '@/lib/stores'

import { registerHappeningInvolvements } from './register-involvements'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerHappeningInvolvements()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(entities).values({
    id: 'char_1',
    branchId: 'br_1',
    kind: 'character',
    name: 'Char',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await db
    .insert(happenings)
    .values({ id: 'hap_1', branchId: 'br_1', title: 'The fire', createdAt: 1, updatedAt: 1 })
  happeningInvolvementsStore.__reset()
  happeningInvolvementsStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const INV: NewHappeningInvolvement = {
  id: 'hinv_1',
  branchId: 'br_1',
  happeningId: 'hap_1',
  entityId: 'char_1',
  role: 'duelist',
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(happeningInvolvements).where(eq(happeningInvolvements.id, id))
  return r
}

describe('happening_involvements CRUD arms', () => {
  it('create + store patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createHappeningInvolvement',
          source: 'ai_classifier',
          payload: { entry: INV },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hinv_1')).role).toBe('duelist')
    expect(happeningInvolvementsStore.getById('hinv_1')?.entityId).toBe('char_1')
  })

  it('update role; reverse-replay restores', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createHappeningInvolvement',
          source: 'ai_classifier',
          payload: { entry: INV },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateHappeningInvolvement',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hinv_1', patch: { role: 'witness' } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hinv_1')).role).toBe('witness')
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect((await rowFor(db, 'hinv_1')).role).toBe('duelist')
    expect(happeningInvolvementsStore.getById('hinv_1')?.role).toBe('duelist')
  })

  it('rejects an update with a non-string role (no row change)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createHappeningInvolvement',
          source: 'ai_classifier',
          payload: { entry: INV },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const res = await applyDeltaAction(
      {
        action: {
          kind: 'updateHappeningInvolvement',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hinv_1', patch: { role: 42 as unknown as string } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(res.status).toBe('rejected')
    expect((await rowFor(db, 'hinv_1')).role).toBe('duelist')
  })

  it('delete; reverse-replay re-inserts the surrogate-id row', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createHappeningInvolvement',
          source: 'ai_classifier',
          payload: { entry: INV },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappeningInvolvement',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hinv_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'hinv_1')).toBeUndefined()
    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'hinv_1')).entityId).toBe('char_1')
    expect(happeningInvolvementsStore.getById('hinv_1')?.role).toBe('duelist')
  })
})
