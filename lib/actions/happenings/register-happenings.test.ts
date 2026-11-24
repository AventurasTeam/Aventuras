import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  happenings,
  happeningInvolvements,
  happeningAwareness,
  stories,
  type Happening,
  type HappeningAwareness,
  type HappeningInvolvement,
  type NewHappening,
  type NewHappeningInvolvement,
  type NewHappeningAwareness,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningsStore, happeningInvolvementsStore, happeningAwarenessStore } from '@/lib/stores'

import { registerHappeningAwareness } from './register-awareness'
import { registerHappenings } from './register-happenings'
import { registerHappeningInvolvements } from './register-involvements'
import { applyDeltaAction, applyDeltaActionGroupWithOutcomes } from '../delta/apply-delta-action'
import { applyRedo, prepareUndo } from '../delta/redo'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { selectReversalSet } from '../delta/row-closure'
import { USER_EDITED_SINCE_PROSE } from '../delta/user-precedence'
import { registerEntities } from '../entities/register'
import { registerStoryEntries } from '../story-entries/register'
import type { PipelineAction } from '../types'

async function setup() {
  __resetRegistry()
  // The live-link filter resolves a restored link's entity through the registry.
  registerEntities()
  registerHappenings()
  registerHappeningInvolvements()
  registerHappeningAwareness()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(entities).values({
    id: 'char_1',
    branchId: 'br_1',
    kind: 'character',
    name: 'Kael',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
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
    expect(happeningsStore.getById('br_1', 'hap_1')?.temporal).toBe('at dawn')
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
          payload: { branchId: 'br_1', id: 'hap_1', patch: {}, proseEntryId: null },
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

  // Drizzle skips an undefined key, so committing would leave the row as it was while the
  // store, the undo payload and History recorded a write.
  it('refuses a column set to undefined, and codes a missing row as not-found', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createHappening', source: 'user_edit', payload: { entry: HAP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const update = (id: string, patch: Record<string, unknown>) =>
      applyDeltaAction(
        {
          action: {
            kind: 'updateHappening',
            source: 'user_edit',
            payload: { branchId: 'br_1', id, patch, proseEntryId: null },
          },
          actionId: 'act_u',
          branchId: 'br_1',
        },
        ctx,
      )

    expect(await update('hap_1', { title: undefined, description: 'rewritten' })).toMatchObject({
      status: 'rejected',
    })
    expect((await rowFor(db, 'hap_1')).description).toEqual('Kael vs Aria')
    expect(happeningsStore.getById('br_1', 'hap_1')?.title).toBe('The duel')
    expect((await db.select().from(deltas)).length).toBe(1)
    expect(await update('hap_9', { description: 'rewritten' })).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
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
            proseEntryId: null,
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).title).toBe('The reckoning')
    expect(happeningsStore.getById('br_1', 'hap_1')?.commonKnowledge).toBe(1)
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect((await rowFor(db, 'hap_1')).title).toBe('The duel')
    expect(happeningsStore.getById('br_1', 'hap_1')?.commonKnowledge).toBe(0)
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
          payload: {
            branchId: 'br_1',
            id: 'hap_1',
            patch: { commonKnowledge: 99 as 0 | 1 },
            proseEntryId: null,
          },
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
    expect(happeningsStore.getById('br_1', 'hap_1')).toBeUndefined()
    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'hap_1')).title).toBe('The duel')
    expect(happeningsStore.getById('br_1', 'hap_1')?.title).toBe('The duel')
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
    expect(happeningsStore.getById('br_1', 'hap_1')?.title).toBe('The duel')

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
    expect(happeningInvolvementsStore.getById('br_1', 'inv_1')).toMatchObject({
      id: 'inv_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'protagonist',
    })
    expect(happeningAwarenessStore.getById('br_1', 'haw_1')).toMatchObject({
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
    const restored = happeningsStore.getById('br_1', 'hap_1')
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
    const set = await selectReversalSet(ctx, { branchId: 'br_1', target: deleteDeltaRows })
    const { group, reverse } = await prepareUndo(set, ctx)
    await reverse()

    // After undo: everything should be restored
    expect(await rowFor(db, 'hap_1')).toBeDefined()
    expect(await countRows('happening_involvements', 'br_1', db)).toBe(1)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(1)
    expect(happeningsStore.getById('br_1', 'hap_1')).toBeDefined()
    expect(happeningInvolvementsStore.getById('br_1', 'inv_1')).toBeDefined()
    expect(happeningAwarenessStore.getById('br_1', 'haw_1')).toBeDefined()

    // Redo the delete: cascade should delete children too, not just parent
    await applyRedo(group, ctx)

    // After redo: all three tables must be empty (tests the cascadeDeleteOps hook)
    expect(await rowFor(db, 'hap_1')).toBeUndefined()
    expect(await countRows('happening_involvements', 'br_1', db)).toBe(0)
    expect(await countRows('happening_awareness', 'br_1', db)).toBe(0)

    expect(happeningsStore.getById('br_1', 'hap_1')).toBeUndefined()
    expect(happeningInvolvementsStore.getById('br_1', 'inv_1')).toBeUndefined()
    expect(happeningAwarenessStore.getById('br_1', 'haw_1')).toBeUndefined()
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
          payload: {
            branchId: 'br_1',
            id: 'hap_1',
            patch: { commonKnowledge: 1 },
            proseEntryId: null,
          },
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
          payload: {
            branchId: 'br_1',
            id: 'hap_1',
            patch: { title: 'The duel' },
            proseEntryId: null,
          },
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
          payload: {
            branchId: 'br_1',
            id: 'hap_1',
            patch: { description: 'new text' },
            proseEntryId: null,
          },
        },
        actionId: 'act_u3',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'hap_1')).embeddingStale).toBe(1) // embedded column changed
  })
})

// cadence.md → User edits and classifier writes; milestone C11's restated mark.
describe('updateHappening — columns that already stand, and the user edits a machine write keeps', () => {
  const PROSE = 'e_prose'
  type Ctx = Awaited<ReturnType<typeof setup>>['ctx']
  type Db = Awaited<ReturnType<typeof setup>>['db']
  type HappeningPatch = Extract<PipelineAction, { kind: 'updateHappening' }>['payload']['patch']

  const apply = (ctx: Ctx, action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'br_1' }, ctx)
  const inGroup = (ctx: Ctx, action: PipelineAction, actionId: string) =>
    applyDeltaActionGroupWithOutcomes([action], { actionId, branchId: 'br_1' }, ctx)
  const deltasOf = (db: Db, actionId: string) =>
    db.select().from(deltas).where(eq(deltas.actionId, actionId))
  const undoOf = async (db: Db, actionId: string) => (await deltasOf(db, actionId))[0]?.undoPayload
  const noop = (reason: string) => ({ status: 'rejected', reason, code: 'noop' })
  const createHap = (ctx: Ctx) =>
    apply(
      ctx,
      { kind: 'createHappening', source: 'ai_classifier', payload: { entry: HAP } },
      'act_c',
    )
  const patchAs = (
    source: 'user_edit' | 'chapter_close',
    patch: HappeningPatch,
    proseEntryId: string | null = null,
  ): PipelineAction => ({
    kind: 'updateHappening',
    source,
    payload: { branchId: 'br_1', id: 'hap_1', patch, proseEntryId },
  })

  async function setupWithProse() {
    const harness = await setup()
    registerStoryEntries()
    return harness
  }
  const writeProse = (ctx: Ctx) =>
    apply(
      ctx,
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: PROSE,
            branchId: 'br_1',
            position: 1,
            kind: 'ai_reply',
            content: 'Kael and Aria cross blades at dawn.',
            createdAt: 1,
          },
        },
      },
      'act_prose',
    )

  it('answers a patch restating every column with the restated noop, logging nothing', async () => {
    const { db, ctx } = await setup()
    await createHap(ctx)
    const restating = patchAs('chapter_close', {
      title: 'The duel',
      description: 'Kael vs Aria',
      temporal: 'at dawn',
      occurredAtEntryId: null,
      commonKnowledge: 0,
    })

    expect(await inGroup(ctx, restating, 'act_g')).toEqual({
      status: 'ok',
      outcomes: [{ status: 'noop', reason: 'no-op happening patch', mark: 'restated' }],
    })
    expect(await apply(ctx, restating, 'act_s')).toEqual(noop('no-op happening patch'))
    expect(await deltasOf(db, 'act_g')).toEqual([])
    expect(await deltasOf(db, 'act_s')).toEqual([])
  })

  it('logs only the column that changed when a patch names two', async () => {
    const { db, ctx } = await setup()
    await createHap(ctx)

    const result = await apply(
      ctx,
      patchAs('chapter_close', { title: 'The duel', description: 'Both fall.' }),
      'act_u',
    )

    expect(result.status).toBe('ok')
    expect(await undoOf(db, 'act_u')).toEqual({ description: 'Kael vs Aria' })
  })

  it('reads an empty entry ref over a null one as restated', async () => {
    const { db, ctx } = await setup()
    await createHap(ctx)

    expect(await apply(ctx, patchAs('chapter_close', { occurredAtEntryId: '' }), 'act_u')).toEqual(
      noop('no-op happening patch'),
    )
    expect(await deltasOf(db, 'act_u')).toEqual([])
  })

  it('keeps a patch naming no column a plain rejection, with no code', async () => {
    const { ctx } = await setup()
    await createHap(ctx)

    expect(await apply(ctx, patchAs('chapter_close', {}), 'act_u')).toEqual({
      status: 'rejected',
      reason: 'update patch for happening br_1:hap_1 has no updatable fields',
    })
  })

  it('clears a stored blank temporal when an entry ref replaces it', async () => {
    const { db, ctx } = await setup()
    // Past the create handler, which stores '' as null: the stored side must not read as null.
    await db.insert(happenings).values({
      id: 'hap_1',
      branchId: 'br_1',
      title: 'The duel',
      temporal: '',
      createdAt: 1,
      updatedAt: 1,
    })

    const result = await apply(
      ctx,
      patchAs('chapter_close', { temporal: null, occurredAtEntryId: 'entry_5' }),
      'act_u',
    )

    expect(result.status).toBe('ok')
    expect(await rowFor(db, 'hap_1')).toMatchObject({
      temporal: null,
      occurredAtEntryId: 'entry_5',
    })
    expect(await undoOf(db, 'act_u')).toEqual({ temporal: '', occurredAtEntryId: null })
  })

  it('checks the time fields on the row a patch leaves, a restated temporal included', async () => {
    const { db, ctx } = await setup()
    await createHap(ctx)

    expect(
      await apply(
        ctx,
        patchAs('chapter_close', { temporal: 'at dawn', occurredAtEntryId: 'entry_5' }),
        'act_u',
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'occurred_at_entry_id and temporal are mutually exclusive',
    })
    expect(await deltasOf(db, 'act_u')).toEqual([])
  })

  it('keeps a column the user wrote after the prose while a sibling lands', async () => {
    const { db, ctx } = await setupWithProse()
    await createHap(ctx)
    await writeProse(ctx)
    await apply(ctx, patchAs('user_edit', { title: 'The reckoning' }), 'act_user')

    const result = await apply(
      ctx,
      patchAs('chapter_close', { title: 'The last duel', description: 'Both fall.' }, PROSE),
      'act_m',
    )

    expect(result.status).toBe('ok')
    expect(await rowFor(db, 'hap_1')).toMatchObject({
      title: 'The reckoning',
      description: 'Both fall.',
    })
    expect(await undoOf(db, 'act_m')).toEqual({ description: 'Kael vs Aria' })
  })

  it('writes over a user edit made before the prose', async () => {
    const { db, ctx } = await setupWithProse()
    await createHap(ctx)
    await apply(ctx, patchAs('user_edit', { title: 'The reckoning' }), 'act_user')
    await writeProse(ctx)

    const result = await apply(
      ctx,
      patchAs('chapter_close', { title: 'The last duel' }, PROSE),
      'act_m',
    )

    expect(result.status).toBe('ok')
    expect((await rowFor(db, 'hap_1')).title).toBe('The last duel')
  })

  it('answers a write whose every column the user kept with USER_EDITED_SINCE_PROSE', async () => {
    const { db, ctx } = await setupWithProse()
    await createHap(ctx)
    await writeProse(ctx)
    await apply(ctx, patchAs('user_edit', { title: 'The reckoning' }), 'act_user')
    const write = patchAs('chapter_close', { title: 'The last duel' }, PROSE)

    expect(await inGroup(ctx, write, 'act_g')).toEqual({
      status: 'ok',
      outcomes: [{ status: 'noop', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect(await apply(ctx, write, 'act_s')).toEqual(noop(USER_EDITED_SINCE_PROSE))
    expect(await deltasOf(db, 'act_g')).toEqual([])
    expect(await deltasOf(db, 'act_s')).toEqual([])
    expect((await rowFor(db, 'hap_1')).title).toBe('The reckoning')
  })

  it("names the user's edit, not a restated column, when neither lands", async () => {
    const { ctx } = await setupWithProse()
    await createHap(ctx)
    await writeProse(ctx)
    await apply(ctx, patchAs('user_edit', { title: 'The reckoning' }), 'act_user')

    expect(
      await apply(
        ctx,
        patchAs('chapter_close', { title: 'The last duel', description: 'Kael vs Aria' }, PROSE),
        'act_m',
      ),
    ).toEqual(noop(USER_EDITED_SINCE_PROSE))
  })

  it('reads a column restating what the user wrote after the prose as restated', async () => {
    const { db, ctx } = await setupWithProse()
    await createHap(ctx)
    await writeProse(ctx)
    await apply(ctx, patchAs('user_edit', { title: 'The reckoning' }), 'act_user')
    const write = patchAs('chapter_close', { title: 'The reckoning' }, PROSE)

    expect(await inGroup(ctx, write, 'act_g')).toEqual({
      status: 'ok',
      outcomes: [{ status: 'noop', reason: 'no-op happening patch', mark: 'restated' }],
    })
    expect(await apply(ctx, write, 'act_s')).toEqual(noop('no-op happening patch'))
    expect(await deltasOf(db, 'act_g')).toEqual([])
    expect(await deltasOf(db, 'act_s')).toEqual([])
  })

  it('writes over a user edit after the prose when the write names no prose', async () => {
    const { db, ctx } = await setupWithProse()
    await createHap(ctx)
    await writeProse(ctx)
    await apply(ctx, patchAs('user_edit', { title: 'The reckoning' }), 'act_user')

    expect(
      (await apply(ctx, patchAs('chapter_close', { title: 'The last duel' }, null), 'act_m'))
        .status,
    ).toBe('ok')
    expect((await rowFor(db, 'hap_1')).title).toBe('The last duel')
  })
})

// Happening ids repeat across branches (the key is branch and id), and so do their children's.
// The sibling br_1 is seeded first, so a read that drops its branch finds the sibling's rows.
describe('branch scope', () => {
  type Harness = Awaited<ReturnType<typeof setup>>
  type BranchId = 'br_1' | 'br_2'

  const SIBLING: Happening = {
    id: 'hap_1',
    branchId: 'br_1',
    title: 'The ambush',
    description: 'Raiders at the ford',
    category: 'battle',
    icon: 'axe',
    temporal: null,
    occurredAtEntryId: 'e_ford',
    commonKnowledge: 1,
    embeddingStale: 0,
    createdAt: 2,
    updatedAt: 2,
  }
  // Stale already: a reversal that restores the row stamps embedding_stale 1.
  const WRITTEN: Happening = {
    id: 'hap_1',
    branchId: 'br_2',
    title: 'The duel',
    description: 'Kael vs Aria',
    category: 'combat',
    icon: 'sword',
    temporal: 'at dawn',
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
  const SIBLING_INV: HappeningInvolvement = {
    id: 'inv_1',
    branchId: 'br_1',
    happeningId: 'hap_1',
    entityId: 'char_1',
    role: 'witness',
  }
  const WRITTEN_INV: HappeningInvolvement = {
    id: 'inv_1',
    branchId: 'br_2',
    happeningId: 'hap_1',
    entityId: 'char_1',
    role: 'protagonist',
  }
  const SIBLING_HAW: HappeningAwareness = {
    id: 'haw_1',
    branchId: 'br_1',
    happeningId: 'hap_1',
    characterId: 'char_1',
    learnedAtEntryId: 'e_rumor',
    decayResistance: 0.2,
    retrievalCount: 3,
    source: 'told',
  }
  const WRITTEN_HAW: HappeningAwareness = {
    id: 'haw_1',
    branchId: 'br_2',
    happeningId: 'hap_1',
    characterId: 'char_1',
    learnedAtEntryId: null,
    decayResistance: 0.5,
    retrievalCount: 0,
    source: 'direct',
  }
  const TARGET_MISMATCH = 'branch mismatch: delta br_2 vs target br_1'

  async function twoBranches({
    written,
    children,
  }: {
    written: boolean
    children: boolean
  }): Promise<Harness> {
    const harness = await setup()
    const { db } = harness
    await db.insert(branches).values({ id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 1 })
    // Both branches hold char_1, so the live-link filter keeps every child a delete captured.
    await db.insert(entities).values({
      id: 'char_1',
      branchId: 'br_2',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(happenings).values(SIBLING)
    if (children) {
      await db.insert(happeningInvolvements).values(SIBLING_INV)
      await db.insert(happeningAwareness).values(SIBLING_HAW)
    }
    if (written) await db.insert(happenings).values(WRITTEN)
    if (written && children) {
      await db.insert(happeningInvolvements).values(WRITTEN_INV)
      await db.insert(happeningAwareness).values(WRITTEN_HAW)
    }
    return harness
  }

  const hapOn = async (db: Harness['db'], branchId: BranchId) =>
    (
      await db
        .select()
        .from(happenings)
        .where(and(eq(happenings.branchId, branchId), eq(happenings.id, 'hap_1')))
    )[0]
  const invOn = async (db: Harness['db'], branchId: BranchId) =>
    (
      await db
        .select()
        .from(happeningInvolvements)
        .where(
          and(eq(happeningInvolvements.branchId, branchId), eq(happeningInvolvements.id, 'inv_1')),
        )
    )[0]
  const hawOn = async (db: Harness['db'], branchId: BranchId) =>
    (
      await db
        .select()
        .from(happeningAwareness)
        .where(and(eq(happeningAwareness.branchId, branchId), eq(happeningAwareness.id, 'haw_1')))
    )[0]
  const allHappenings = (db: Harness['db']) =>
    db.select().from(happenings).orderBy(happenings.branchId, happenings.id)
  const deltasOf = (db: Harness['db'], actionId: string) =>
    db.select().from(deltas).where(eq(deltas.actionId, actionId))
  const undoOf = async (db: Harness['db'], actionId: string) =>
    (await deltasOf(db, actionId))[0]?.undoPayload
  const onFork = (ctx: Harness['ctx'], action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'br_2' }, ctx)

  const PAYLOAD_CASES: { action: PipelineAction; reason: string }[] = [
    {
      action: {
        kind: 'createHappening',
        source: 'ai_classifier',
        payload: { entry: { ...WRITTEN, id: 'hap_9', branchId: 'br_1' } },
      },
      reason: 'branch mismatch: delta br_2 vs entry br_1',
    },
    {
      action: {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'hap_1',
          patch: { title: 'The rout' },
          proseEntryId: null,
        },
      },
      reason: TARGET_MISMATCH,
    },
    {
      action: {
        kind: 'deleteHappening',
        source: 'periodic_classifier',
        payload: { branchId: 'br_1', id: 'hap_1' },
      },
      reason: TARGET_MISMATCH,
    },
  ]

  it.each(PAYLOAD_CASES.map((c) => [c.action.kind, c] as const))(
    '%s payload: names the sibling branch and is refused, both rows unchanged',
    async (_kind, { action, reason }) => {
      const { db, ctx } = await twoBranches({ written: true, children: false })
      expect(await onFork(ctx, action, 'act_p')).toEqual({ status: 'rejected', reason })
      expect(await allHappenings(db)).toEqual([SIBLING, WRITTEN])
      expect(await deltasOf(db, 'act_p')).toEqual([])
    },
  )

  it('createHappening pair: creates the row on its own branch, and the reversal removes only that row', async () => {
    const { db, ctx } = await twoBranches({ written: false, children: false })
    const create: PipelineAction = {
      kind: 'createHappening',
      source: 'ai_classifier',
      payload: { entry: WRITTEN },
    }
    expect(await onFork(ctx, create, 'act_c')).toEqual({ status: 'ok', logPosition: 1 })
    expect(await hapOn(db, 'br_2')).toEqual(WRITTEN)
    expect(await hapOn(db, 'br_1')).toEqual(SIBLING)

    expect(await reverseReplayDeltas('act_c', ctx)).toBe(1)
    expect(await hapOn(db, 'br_2')).toBeUndefined()
    expect(await hapOn(db, 'br_1')).toEqual(SIBLING)
  })

  it("updateHappening pair: patches its own branch's row from that row, and the reversal restores it", async () => {
    const { db, ctx } = await twoBranches({ written: true, children: false })
    const patch = {
      title: 'The last duel',
      description: 'Both fall.',
      category: 'feud',
      icon: 'skull',
    }
    const update: PipelineAction = {
      kind: 'updateHappening',
      source: 'user_edit',
      payload: { branchId: 'br_2', id: 'hap_1', patch, proseEntryId: null },
    }
    expect(await onFork(ctx, update, 'act_u')).toEqual({ status: 'ok', logPosition: 1 })
    expect(await undoOf(db, 'act_u')).toEqual({
      title: 'The duel',
      description: 'Kael vs Aria',
      category: 'combat',
      icon: 'sword',
    })
    expect(await hapOn(db, 'br_2')).toEqual({ ...WRITTEN, ...patch })
    expect(await hapOn(db, 'br_1')).toEqual(SIBLING)

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect(await hapOn(db, 'br_2')).toEqual(WRITTEN)
    expect(await hapOn(db, 'br_1')).toEqual(SIBLING)
  })

  it("deleteHappening pair: deletes its own branch's row and children, and the reversal restores only those", async () => {
    const { db, ctx } = await twoBranches({ written: true, children: true })
    const remove: PipelineAction = {
      kind: 'deleteHappening',
      source: 'periodic_classifier',
      payload: { branchId: 'br_2', id: 'hap_1' },
    }
    expect(await onFork(ctx, remove, 'act_d')).toEqual({ status: 'ok', logPosition: 1 })
    expect(await undoOf(db, 'act_d')).toEqual({
      ...WRITTEN,
      involvements: [WRITTEN_INV],
      awareness: [WRITTEN_HAW],
      translations: [],
    })
    expect(await hapOn(db, 'br_2')).toBeUndefined()
    expect(await invOn(db, 'br_2')).toBeUndefined()
    expect(await hawOn(db, 'br_2')).toBeUndefined()
    expect(await hapOn(db, 'br_1')).toEqual(SIBLING)
    expect(await invOn(db, 'br_1')).toEqual(SIBLING_INV)
    expect(await hawOn(db, 'br_1')).toEqual(SIBLING_HAW)

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect(await hapOn(db, 'br_2')).toEqual(WRITTEN)
    expect(await invOn(db, 'br_2')).toEqual(WRITTEN_INV)
    expect(await hawOn(db, 'br_2')).toEqual(WRITTEN_HAW)
    expect(await hapOn(db, 'br_1')).toEqual(SIBLING)
    expect(await invOn(db, 'br_1')).toEqual(SIBLING_INV)
    expect(await hawOn(db, 'br_1')).toEqual(SIBLING_HAW)
  })
})
