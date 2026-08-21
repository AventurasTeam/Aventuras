import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  happenings,
  happeningInvolvements,
  happeningAwareness,
  stories,
  type NewHappening,
  type NewHappeningInvolvement,
  type NewHappeningAwareness,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningsStore, happeningInvolvementsStore, happeningAwarenessStore } from '@/lib/stores'

import { registerHappeningAwareness } from './register-awareness'
import { registerHappenings } from './register-happenings'
import { registerHappeningInvolvements } from './register-involvements'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { applyRedo, snapshotForRedo } from '../delta/redo'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas, reverseAndPruneDeltaRows } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerHappenings()
  registerHappeningInvolvements()
  registerHappeningAwareness()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  happeningsStore.__reset()
  happeningsStore.hydrate('br_1', [])
  happeningInvolvementsStore.__reset()
  happeningInvolvementsStore.hydrate('br_1', [])
  happeningAwarenessStore.__reset()
  happeningAwarenessStore.hydrate('br_1', [])
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

async function countRows(
  table: 'happening_involvements' | 'happening_awareness',
  branchId: string,
  db: Awaited<ReturnType<typeof setup>>['db'],
) {
  const targetTable =
    table === 'happening_involvements' ? happeningInvolvements : happeningAwareness
  const rows = await db.select().from(targetTable).where(eq(targetTable.branchId, branchId))
  return rows.length
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

  it('deleting a happening also removes its involvements and awareness rows', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const inv: NewHappeningInvolvement = {
      id: 'inv_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'protagonist',
    }
    const aware: NewHappeningAwareness = {
      id: 'haw_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      learnedAtEntryId: null,
      decayResistance: null,
      source: 'direct',
    }
    await db.insert(happeningInvolvements).values(inv)
    await db.insert(happeningAwareness).values(aware)

    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'periodic_classifier',
          payload: { branchId: 'br_1', id: 'hap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'hap_1')).toBeUndefined()
    expect(await countRows('happening_involvements', 'br_1', db)).toBe(0)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(0)
  })

  it('carries the cascaded rows in the undo payload so reverse-replay restores them', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const inv: NewHappeningInvolvement = {
      id: 'inv_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'protagonist',
    }
    const aware: NewHappeningAwareness = {
      id: 'haw_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      learnedAtEntryId: null,
      decayResistance: null,
      source: 'direct',
    }
    await db.insert(happeningInvolvements).values(inv)
    await db.insert(happeningAwareness).values(aware)

    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'periodic_classifier',
          payload: { branchId: 'br_1', id: 'hap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    const deltasAfter = await db.select().from(deltas)
    const deleteDelta = deltasAfter.find((d) => d.actionId === 'act_d')
    expect(deleteDelta?.undoPayload).toMatchObject({
      involvements: expect.arrayContaining([
        expect.objectContaining({ happeningId: 'hap_1', id: 'inv_1' }),
      ]),
      awareness: expect.arrayContaining([
        expect.objectContaining({ happeningId: 'hap_1', id: 'haw_1' }),
      ]),
    })
  })

  it('round-trip delete: undo restores happening and both child tables', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const inv: NewHappeningInvolvement = {
      id: 'inv_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'protagonist',
    }
    const aware: NewHappeningAwareness = {
      id: 'haw_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      learnedAtEntryId: null,
      decayResistance: 0.5,
      source: 'direct',
    }
    await db.insert(happeningInvolvements).values(inv)
    await db.insert(happeningAwareness).values(aware)

    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'periodic_classifier',
          payload: { branchId: 'br_1', id: 'hap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'hap_1')).toBeUndefined()
    expect(await countRows('happening_involvements', 'br_1', db)).toBe(0)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(0)

    // Reverse the delete
    await reverseReplayDeltas('act_d', ctx)

    // Verify all three tables are restored
    const restoredHap = await rowFor(db, 'hap_1')
    expect(restoredHap).toBeDefined()
    expect(restoredHap?.title).toBe('The duel')
    expect(happeningsStore.getById('hap_1')?.title).toBe('The duel')

    expect(await countRows('happening_involvements', 'br_1', db)).toBe(1)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(1)

    // Verify the child rows have correct data in DB
    const [restoredInv] = await db
      .select()
      .from(happeningInvolvements)
      .where(eq(happeningInvolvements.id, 'inv_1'))
    expect(restoredInv).toMatchObject({
      id: 'inv_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'protagonist',
    })

    const [restoredAware] = await db
      .select()
      .from(happeningAwareness)
      .where(eq(happeningAwareness.id, 'haw_1'))
    expect(restoredAware).toMatchObject({
      id: 'haw_1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      decayResistance: 0.5,
      source: 'direct',
    })

    // Verify the child rows are synced to stores
    expect(happeningInvolvementsStore.getById('inv_1')).toMatchObject({
      id: 'inv_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'protagonist',
    })
    expect(happeningAwarenessStore.getById('haw_1')).toMatchObject({
      id: 'haw_1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      decayResistance: 0.5,
      source: 'direct',
    })
  })

  // A childless happening still carries `involvements: []` / `awareness: []` in
  // its undo payload. Declaring the cascade keys only for non-empty arrays leaves
  // them on the parent row, and the restored store row grows two phantom fields
  // (the SQL insert survives only because drizzle drops non-column keys).
  it('restores a childless happening without leaking the cascade keys onto the row', async () => {
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
          source: 'periodic_classifier',
          payload: { branchId: 'br_1', id: 'hap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )

    await reverseReplayDeltas('act_d', ctx)

    expect(await rowFor(db, 'hap_1')).toBeDefined()
    const restored = happeningsStore.getById('hap_1')
    expect(restored).toBeDefined()
    expect(restored).not.toHaveProperty('involvements')
    expect(restored).not.toHaveProperty('awareness')
  })

  it('redo of a cascading delete leaves all tables (parent + children) empty in DB and stores', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const inv: NewHappeningInvolvement = {
      id: 'inv_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'protagonist',
    }
    const aware: NewHappeningAwareness = {
      id: 'haw_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      learnedAtEntryId: null,
      decayResistance: 0.5,
      source: 'direct',
    }
    await db.insert(happeningInvolvements).values(inv)
    await db.insert(happeningAwareness).values(aware)

    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'periodic_classifier',
          payload: { branchId: 'br_1', id: 'hap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    // After delete: all three tables should be empty
    expect(await countRows('happening_involvements', 'br_1', db)).toBe(0)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(0)
    expect(await rowFor(db, 'hap_1')).toBeUndefined()

    // Undo the delete: capture snapshot first, then prune (remove) the delta
    const deleteDeltaRows = await db.select().from(deltas).where(eq(deltas.actionId, 'act_d'))
    const snapshots = await snapshotForRedo(deleteDeltaRows, ctx)
    await reverseAndPruneDeltaRows(deleteDeltaRows, ctx)

    // After undo: everything should be restored
    expect(await rowFor(db, 'hap_1')).toBeDefined()
    expect(await countRows('happening_involvements', 'br_1', db)).toBe(1)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(1)
    expect(happeningsStore.getById('hap_1')).toBeDefined()
    expect(happeningInvolvementsStore.getById('inv_1')).toBeDefined()
    expect(happeningAwarenessStore.getById('haw_1')).toBeDefined()

    // Redo the delete: cascade should delete children too, not just parent
    await applyRedo(snapshots, ctx)

    // After redo: all three tables must be empty (tests the cascadeDeleteOps hook)
    expect(await rowFor(db, 'hap_1')).toBeUndefined()
    expect(await countRows('happening_involvements', 'br_1', db)).toBe(0)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(0)

    expect(happeningsStore.getById('hap_1')).toBeUndefined()
    expect(happeningInvolvementsStore.getById('inv_1')).toBeUndefined()
    expect(happeningAwarenessStore.getById('haw_1')).toBeUndefined()
  })

  it('defaults embedding_stale to 1 on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).embeddingStale).toBe(1)
  })

  it('flips embedding_stale only when an embedded column changes', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createHappening',
          source: 'ai_classifier',
          payload: { entry: { ...HAP, embeddingStale: 0 } },
        },
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
          payload: { branchId: 'br_1', id: 'hap_1', patch: { commonKnowledge: 1 } },
        },
        actionId: 'act_u1',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).embeddingStale).toBe(0) // non-embedded columns don't flip

    await applyDeltaAction(
      {
        action: {
          kind: 'updateHappening',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hap_1', patch: { title: 'The duel' } },
        },
        actionId: 'act_u2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).embeddingStale).toBe(0) // same value re-sent compares equal

    await applyDeltaAction(
      {
        action: {
          kind: 'updateHappening',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hap_1', patch: { description: 'new text' } },
        },
        actionId: 'act_u3',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).embeddingStale).toBe(1) // embedded column changed
  })
})
