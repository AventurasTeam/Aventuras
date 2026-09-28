import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { applyDeltaAction, applyDeltaActionGroup } from './apply-delta-action'
import type { DbCtx } from '../types'

const character = (id: string, name: string): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

let ctx: DbCtx

beforeEach(async () => {
  const { db, runInTransaction } = await createTestDb()
  ctx = { db, runInTransaction }
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(entities).values([character('char_a', 'Aria'), character('char_b', 'Bren')])
  await db
    .insert(happenings)
    .values({ id: 'hap_1', branchId: 'b1', title: 'The fire', createdAt: 1, updatedAt: 1 })
})

const one = (action: Parameters<typeof applyDeltaAction>[0]['action']) =>
  applyDeltaAction({ action, actionId: 'act_1', branchId: 'b1' }, ctx)

describe('link writers refuse a row that is gone', () => {
  it('drops an awareness row naming a deleted character', async () => {
    const result = await one({
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', characterId: 'char_gone', happeningId: 'hap_1' },
    })
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await ctx.db.select().from(happeningAwareness)).toEqual([])
  })

  it('drops an involvement naming a deleted happening', async () => {
    const result = await one({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_1', branchId: 'b1', happeningId: 'hap_gone', entityId: 'char_a' },
      },
    })
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
  })

  it('drops a relationship naming a deleted character', async () => {
    const result = await one({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: 'b1',
        subjectId: 'char_a',
        objectId: 'char_gone',
        kind: 'rival',
        proseEntryId: null,
      },
    })
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await ctx.db.select().from(characterRelationships)).toEqual([])
  })
})

describe('a row created earlier in the same group counts as present', () => {
  it("keeps a Plot create's links to its new happening", async () => {
    const result = await applyDeltaActionGroup(
      [
        {
          kind: 'createHappening',
          source: 'user_edit',
          payload: {
            entry: {
              id: 'hap_new',
              branchId: 'b1',
              title: 'A new thing',
              createdAt: 2,
              updatedAt: 2,
            },
          },
        },
        {
          kind: 'createHappeningInvolvement',
          source: 'user_edit',
          payload: {
            entry: { id: 'hinv_new', branchId: 'b1', happeningId: 'hap_new', entityId: 'char_a' },
          },
        },
        {
          kind: 'upsertHappeningAwareness',
          source: 'user_edit',
          payload: { branchId: 'b1', characterId: 'char_b', happeningId: 'hap_new' },
        },
      ],
      { actionId: 'act_2', branchId: 'b1' },
      ctx,
    )
    expect(result).toEqual({ status: 'ok' })
    expect(await ctx.db.select().from(happeningInvolvements)).toHaveLength(1)
    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(1)
  })

  it("keeps a World create's relationship to its new character", async () => {
    const result = await applyDeltaActionGroup(
      [
        {
          kind: 'createEntity',
          source: 'user_edit',
          payload: { entry: character('char_new', 'Cato') },
        },
        {
          kind: 'upsertCharacterRelationship',
          source: 'user_edit',
          payload: {
            branchId: 'b1',
            subjectId: 'char_new',
            objectId: 'char_a',
            kind: 'brother',
            inverseKind: 'sister',
          },
        },
      ],
      { actionId: 'act_3', branchId: 'b1' },
      ctx,
    )
    expect(result).toEqual({ status: 'ok' })
    const pairs = await ctx.db
      .select()
      .from(characterRelationships)
      .where(and(eq(characterRelationships.branchId, 'b1')))
    expect(pairs).toHaveLength(1)
  })
})
