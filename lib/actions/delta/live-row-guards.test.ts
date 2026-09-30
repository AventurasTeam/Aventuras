import { eq } from 'drizzle-orm'
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

const characterOn = (branchId: string, id: string, name: string): NewEntity => ({
  id,
  branchId,
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const character = (id: string, name: string): NewEntity => characterOn('b1', id, name)

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
  it.each([
    {
      name: 'an involvement naming a deleted happening',
      table: happeningInvolvements,
      action: {
        kind: 'createHappeningInvolvement' as const,
        source: 'periodic_classifier' as const,
        payload: {
          entry: { id: 'hinv_1', branchId: 'b1', happeningId: 'hap_gone', entityId: 'char_a' },
        },
      },
    },
    {
      name: 'an involvement naming a deleted entity',
      table: happeningInvolvements,
      action: {
        kind: 'createHappeningInvolvement' as const,
        source: 'periodic_classifier' as const,
        payload: {
          entry: { id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_gone' },
        },
      },
    },
    {
      name: 'an awareness row naming a deleted character',
      table: happeningAwareness,
      action: {
        kind: 'upsertHappeningAwareness' as const,
        source: 'periodic_classifier' as const,
        payload: { branchId: 'b1', characterId: 'char_gone', happeningId: 'hap_1' },
      },
    },
    {
      name: 'an awareness row naming a deleted happening',
      table: happeningAwareness,
      action: {
        kind: 'upsertHappeningAwareness' as const,
        source: 'periodic_classifier' as const,
        payload: { branchId: 'b1', characterId: 'char_a', happeningId: 'hap_gone' },
      },
    },
    {
      name: 'a relationship naming a deleted subject',
      table: characterRelationships,
      action: {
        kind: 'upsertCharacterRelationship' as const,
        source: 'periodic_classifier' as const,
        payload: {
          branchId: 'b1',
          subjectId: 'char_gone',
          objectId: 'char_a',
          kind: 'rival',
          proseEntryId: null,
        },
      },
    },
    {
      name: 'a relationship naming a deleted object',
      table: characterRelationships,
      action: {
        kind: 'upsertCharacterRelationship' as const,
        source: 'periodic_classifier' as const,
        payload: {
          branchId: 'b1',
          subjectId: 'char_a',
          objectId: 'char_gone',
          kind: 'rival',
          proseEntryId: null,
        },
      },
    },
    // World Save relationship writes always send inverseKind, hitting bothPovOutcome's own guard,
    // not the single-POV one above; the pair sorts by id, so the two cases below hit both sides.
    {
      name: 'a two-view relationship naming a dead id sorted before the pair',
      table: characterRelationships,
      action: {
        kind: 'upsertCharacterRelationship' as const,
        source: 'periodic_classifier' as const,
        payload: {
          branchId: 'b1',
          subjectId: 'a_gone',
          objectId: 'char_a',
          kind: 'brother',
          inverseKind: 'sister',
        },
      },
    },
    {
      name: 'a two-view relationship naming a dead id sorted after the pair',
      table: characterRelationships,
      action: {
        kind: 'upsertCharacterRelationship' as const,
        source: 'periodic_classifier' as const,
        payload: {
          branchId: 'b1',
          subjectId: 'char_a',
          objectId: 'char_gone',
          kind: 'brother',
          inverseKind: 'sister',
        },
      },
    },
  ])('drops $name', async ({ action, table }) => {
    const result = await one(action)
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await ctx.db.select().from(table)).toEqual([])
  })
})

describe('a row alive on another branch does not satisfy the guard', () => {
  it('refuses an entity id that exists only on a sibling branch', async () => {
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await ctx.db.insert(entities).values(characterOn('b2', 'char_only_b2', 'Only on b2'))

    const result = await one({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_only_b2' },
      },
    })
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
  })

  it('refuses a happening id that exists only on a sibling branch', async () => {
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await ctx.db.insert(happenings).values({
      id: 'hap_only_b2',
      branchId: 'b2',
      title: 'Only on b2',
      createdAt: 1,
      updatedAt: 1,
    })

    const result = await one({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_1', branchId: 'b1', happeningId: 'hap_only_b2', entityId: 'char_a' },
      },
    })
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
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
      .where(eq(characterRelationships.branchId, 'b1'))
    expect(pairs).toHaveLength(1)
  })
})
