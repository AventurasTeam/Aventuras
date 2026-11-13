import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  happenings,
  happeningAwareness,
  happeningInvolvements,
  stories,
  type NewHappeningInvolvement,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningAwarenessStore, happeningInvolvementsStore } from '@/lib/stores'

import { registerHappeningAwareness } from './register-awareness'
import { registerHappenings } from './register-happenings'
import { registerHappeningInvolvements } from './register-involvements'
import { applyDeltaAction, applyDeltaActionGroupWithOutcomes } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { USER_EDITED_SINCE_PROSE, userDeletedHappeningLink } from '../delta/user-precedence'
import { registerEntities } from '../entities/register'
import { registerStoryEntries } from '../story-entries/register'
import type { DeltaSource, PipelineAction } from '../types'

async function setup() {
  __resetRegistry()
  // missingRef resolves the involvement's happening and entity through the registry.
  registerEntities()
  registerHappenings()
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

  it('no-ops a role update that changes nothing, writing no delta', async () => {
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
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateHappeningInvolvement',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'hinv_1', patch: { role: 'duelist' } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await db.select().from(deltas)).toHaveLength(1)
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

const PROSE = 'e_prose'
type Ctx = Awaited<ReturnType<typeof setup>>['ctx']
type Db = Awaited<ReturnType<typeof setup>>['db']

async function setupWithProse() {
  const harness = await setup()
  registerStoryEntries()
  await harness.db.insert(entities).values({
    id: 'char_2',
    branchId: 'br_1',
    kind: 'character',
    name: 'Bren',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await harness.db
    .insert(happenings)
    .values({ id: 'hap_2', branchId: 'br_1', title: 'The flood', createdAt: 1, updatedAt: 1 })
  return harness
}

const run = (ctx: Ctx, action: PipelineAction, actionId: string) =>
  applyDeltaAction({ action, actionId, branchId: 'br_1' }, ctx)

const writeProse = (ctx: Ctx) =>
  run(
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
          content: 'Char and Bren fight the fire.',
          createdAt: 1,
        },
      },
    },
    'act_prose',
  )

// cadence.md → User edits and classifier writes: an involvement the user removed after the prose a
// close cites stays removed.
describe('createHappeningInvolvement under user precedence', () => {
  const userWon = { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }
  const CARRIED: NewHappeningInvolvement = { ...INV, id: 'hinv_carried' }

  // `proseEntryId` undefined builds a payload without the key, so "absent" is tested as absent.
  const involve = (
    source: DeltaSource,
    entry: NewHappeningInvolvement,
    proseEntryId?: string | null,
  ): PipelineAction => ({
    kind: 'createHappeningInvolvement',
    source,
    payload: proseEntryId === undefined ? { entry } : { entry, proseEntryId },
  })

  const uninvolve = (id: string): PipelineAction => ({
    kind: 'deleteHappeningInvolvement',
    source: 'user_edit',
    payload: { branchId: 'br_1', id },
  })

  const involvementsOf = (db: Db, happeningId: string, entityId: string) =>
    db
      .select()
      .from(happeningInvolvements)
      .where(
        and(
          eq(happeningInvolvements.happeningId, happeningId),
          eq(happeningInvolvements.entityId, entityId),
        ),
      )

  it('leaves an involvement the user removed after the prose removed', async () => {
    const { db, ctx } = await setupWithProse()
    await run(ctx, involve('ai_classifier', INV), 'act_c')
    await writeProse(ctx)
    await run(ctx, uninvolve('hinv_1'), 'act_d')

    expect(await run(ctx, involve('chapter_close', CARRIED, PROSE), 'act_close')).toEqual(userWon)

    expect(await involvementsOf(db, 'hap_1', 'char_1')).toEqual([])
    expect(await db.select().from(deltas).where(eq(deltas.actionId, 'act_close'))).toEqual([])
    expect(happeningInvolvementsStore.getById('hinv_carried')).toBeUndefined()
  })

  it('re-creates an involvement the user removed before the prose', async () => {
    const { db, ctx } = await setupWithProse()
    await run(ctx, involve('ai_classifier', INV), 'act_c')
    await run(ctx, uninvolve('hinv_1'), 'act_d')
    await writeProse(ctx)

    expect((await run(ctx, involve('chapter_close', CARRIED, PROSE), 'act_close')).status).toBe(
      'ok',
    )
    expect((await involvementsOf(db, 'hap_1', 'char_1')).map((r) => r.id)).toEqual(['hinv_carried'])
  })

  it('checks nothing when the create names no prose, absent or null', async () => {
    const { db, ctx } = await setupWithProse()
    await run(ctx, involve('ai_classifier', INV), 'act_c')
    await writeProse(ctx)
    await run(ctx, uninvolve('hinv_1'), 'act_d')

    expect((await run(ctx, involve('chapter_close', CARRIED), 'act_absent')).status).toBe('ok')
    expect(
      (await run(ctx, involve('chapter_close', { ...CARRIED, id: 'hinv_null' }, null), 'act_null'))
        .status,
    ).toBe('ok')
    expect((await involvementsOf(db, 'hap_1', 'char_1')).map((r) => r.id).sort()).toEqual([
      'hinv_carried',
      'hinv_null',
    ])
  })

  it("creates an involvement when the user removed the entity's in another happening", async () => {
    const { db, ctx } = await setupWithProse()
    await run(
      ctx,
      involve('ai_classifier', { ...INV, id: 'hinv_flood', happeningId: 'hap_2' }),
      'act_c',
    )
    await writeProse(ctx)
    await run(ctx, uninvolve('hinv_flood'), 'act_d')

    expect((await run(ctx, involve('chapter_close', CARRIED, PROSE), 'act_close')).status).toBe(
      'ok',
    )
    expect(await involvementsOf(db, 'hap_1', 'char_1')).toHaveLength(1)
  })

  it("creates an involvement when the user removed another entity's in the happening", async () => {
    const { db, ctx } = await setupWithProse()
    await run(
      ctx,
      involve('ai_classifier', { ...INV, id: 'hinv_bren', entityId: 'char_2' }),
      'act_c',
    )
    await writeProse(ctx)
    await run(ctx, uninvolve('hinv_bren'), 'act_d')

    expect((await run(ctx, involve('chapter_close', CARRIED, PROSE), 'act_close')).status).toBe(
      'ok',
    )
    expect(await involvementsOf(db, 'hap_1', 'char_1')).toHaveLength(1)
  })

  it('reports a refused create as its own noop inside a group, the rest landing', async () => {
    const { db, ctx } = await setupWithProse()
    await run(ctx, involve('ai_classifier', INV), 'act_c')
    await writeProse(ctx)
    await run(ctx, uninvolve('hinv_1'), 'act_d')

    const result = await applyDeltaActionGroupWithOutcomes(
      [
        involve('chapter_close', CARRIED, PROSE),
        involve('chapter_close', { ...INV, id: 'hinv_bren', entityId: 'char_2' }, PROSE),
      ],
      { actionId: 'act_close', branchId: 'br_1' },
      ctx,
    )

    expect(result).toEqual({
      status: 'ok',
      outcomes: [{ status: 'noop', reason: USER_EDITED_SINCE_PROSE }, { status: 'landed' }],
    })
    expect(await involvementsOf(db, 'hap_1', 'char_1')).toEqual([])
    expect((await involvementsOf(db, 'hap_1', 'char_2')).map((r) => r.id)).toEqual(['hinv_bren'])
  })
})

type LinkTable = {
  name: string
  /** Links char_1 to the happening; the new row's id. */
  add: (ctx: Ctx, happeningId: string) => Promise<string>
  remove: (id: string) => PipelineAction
}

const LINK_TABLES: readonly LinkTable[] = [
  {
    name: 'an involvement',
    add: async (ctx, happeningId) => {
      const id = `hinv_${happeningId}`
      await run(
        ctx,
        {
          kind: 'createHappeningInvolvement',
          source: 'ai_classifier',
          payload: { entry: { ...INV, id, happeningId } },
        },
        `act_add_${id}`,
      )
      return id
    },
    remove: (id) => ({
      kind: 'deleteHappeningInvolvement',
      source: 'user_edit',
      payload: { branchId: 'br_1', id },
    }),
  },
  {
    name: 'an awareness row',
    add: async (ctx, happeningId) => {
      await run(
        ctx,
        {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: {
            branchId: 'br_1',
            characterId: 'char_1',
            happeningId,
            decayResistance: 0.5,
            proseEntryId: null,
          },
        },
        `act_add_haw_${happeningId}`,
      )
      const [row] = await ctx.db
        .select({ id: happeningAwareness.id })
        .from(happeningAwareness)
        .where(eq(happeningAwareness.happeningId, happeningId))
      if (row === undefined) throw new Error(`no awareness on ${happeningId}`)
      return row.id
    },
    remove: (id) => ({
      kind: 'deleteHappeningAwareness',
      source: 'user_edit',
      payload: { branchId: 'br_1', id },
    }),
  },
]

describe.each(LINK_TABLES)('userDeletedHappeningLink over $name', ({ add, remove }) => {
  async function setupLinks() {
    const harness = await setupWithProse()
    registerHappeningAwareness()
    happeningAwarenessStore.__reset()
    happeningAwarenessStore.hydrate('br_1', [])
    return harness
  }

  const deletedOn = (ctx: Ctx, happeningId: string) =>
    userDeletedHappeningLink({ branchId: 'br_1', happeningId, proseEntryId: PROSE }, ctx)

  it('reads a removal after the prose as deleted', async () => {
    const { ctx } = await setupLinks()
    const id = await add(ctx, 'hap_1')
    await writeProse(ctx)
    await run(ctx, remove(id), 'act_remove')

    expect(await deletedOn(ctx, 'hap_1')).toBe(true)
  })

  it('reads no removal before the prose', async () => {
    const { ctx } = await setupLinks()
    const id = await add(ctx, 'hap_1')
    await run(ctx, remove(id), 'act_remove')
    await writeProse(ctx)

    expect(await deletedOn(ctx, 'hap_1')).toBe(false)
  })

  it("reads no removal on another happening's links", async () => {
    const { ctx } = await setupLinks()
    const id = await add(ctx, 'hap_2')
    await writeProse(ctx)
    await run(ctx, remove(id), 'act_remove')

    expect(await deletedOn(ctx, 'hap_1')).toBe(false)
  })
})
