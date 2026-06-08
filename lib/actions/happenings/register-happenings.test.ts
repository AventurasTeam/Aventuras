import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, happenings, stories, type NewHappening } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningsStore } from '@/lib/stores'

import { registerHappenings } from './register-happenings'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerHappenings()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  happeningsStore.__reset()
  happeningsStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const HAP: NewHappening = {
  id: 'hap_1',
  branchId: 'br_1',
  title: 'The duel',
  description: 'Kael vs Aria',
  temporal: 'at dawn',
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(happenings).where(eq(happenings.id, id))
  return r
}

describe('happenings CRUD arms', () => {
  it('create writes the row + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).title).toBe('The duel')
    expect(happeningsStore.getById('hap_1')?.temporal).toBe('at dawn')
  })

  it('rejects a create with both time fields (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad: NewHappening = { ...HAP, occurredAtEntryId: 'entry_5' }
    const res = await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(res.status).toBe('rejected')
    expect(await rowFor(db, 'hap_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('rejects an empty-set update (no updatable fields → no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateHappening',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hap_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'hap_1')).title).toBe('The duel') // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  it('update produces whole-value undo; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateHappening',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'hap_1',
            patch: { title: 'The reckoning', commonKnowledge: 1 },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).title).toBe('The reckoning')
    expect(happeningsStore.getById('hap_1')?.commonKnowledge).toBe(1)
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect((await rowFor(db, 'hap_1')).title).toBe('The duel')
    expect(happeningsStore.getById('hap_1')?.commonKnowledge).toBe(0)
  })

  it('rejects an update with an out-of-range commonKnowledge (no row change, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const res = await applyDeltaAction(
      {
        action: {
          kind: 'updateHappening',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hap_1', patch: { commonKnowledge: 99 as 0 | 1 } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(res.status).toBe('rejected')
    expect((await rowFor(db, 'hap_1')).commonKnowledge).toBe(0)
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'hap_1')).toBeUndefined()
    expect(happeningsStore.getById('hap_1')).toBeUndefined()
    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'hap_1')).title).toBe('The duel')
    expect(happeningsStore.getById('hap_1')?.title).toBe('The duel')
  })
})
