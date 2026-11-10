import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  emptyEntityState,
  entities,
  lore,
  stories,
  type NewEntity,
  type NewLore,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { collisionPairOf, entityMergeActions, storyPlaceOf } from '@/lib/world'

import type { DbCtx, DeltaSource, PipelineAction } from '../types'
import { applyDeltaAction, applyDeltaActionGroup } from './apply-delta-action'
import { deltaRowOp } from './delta-row'
import {
  keywordAuthors,
  keywordPairsFlagReason,
  keywordUserAddedReason,
  protectedKeywordTerms,
} from './keyword-authors'
import { reverseReplayDeltas } from './reverse-replay'

const BRANCH = 'br_1'

async function setup(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 'story_1', name: 'main', createdAt: 1 })
  return { db, runInTransaction }
}

const KAEL: NewEntity = {
  id: 'char_1',
  branchId: BRANCH,
  kind: 'character',
  name: 'Kael',
  status: 'active',
  injectionMode: 'auto',
  state: emptyEntityState('character'),
  createdAt: 1,
  updatedAt: 1,
}

const AETHER: NewLore = {
  id: 'lore_1',
  branchId: BRANCH,
  title: 'Aether',
  body: 'The magic that binds.',
  keywords: ['aether'],
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

// Throws on a refusal, so a setup write that didn't land can't let a test pass vacuously.
async function applyOk(ctx: DbCtx, action: PipelineAction, actionId: string): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: BRANCH }, ctx)
  if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
}

const createdBy = (source: DeltaSource, entry: NewEntity): PipelineAction => ({
  kind: 'createEntity',
  source,
  payload: { entry },
})

const appended = (source: DeltaSource, keywords: string[]): PipelineAction => ({
  kind: 'appendEntityKeywords',
  source,
  payload: { branchId: BRANCH, id: 'char_1', keywords, proseEntryId: null },
})

const userKeywords = (keywords: string[]): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: BRANCH, id: 'char_1', patch: { keywords } },
})

async function liveKeywords(ctx: DbCtx, table: 'entities' | 'lore', id: string) {
  if (table === 'lore') {
    const [row] = await ctx.db.select().from(lore).where(eq(lore.id, id))
    return row.keywords
  }
  const [row] = await ctx.db.select().from(entities).where(eq(entities.id, id))
  return row.keywords
}

async function authorsOf(ctx: DbCtx, table: 'entities' | 'lore' = 'entities', id = 'char_1') {
  const live = await liveKeywords(ctx, table, id)
  return Object.fromEntries(await keywordAuthors(ctx, BRANCH, table, id, live))
}

describe('keywordAuthors', () => {
  it("credits a term the create carried to the create's source", async () => {
    const ctx = await setup()
    await applyOk(
      ctx,
      createdBy('periodic_classifier', { ...KAEL, keywords: ['The Knight'] }),
      'act_c',
    )
    expect(await authorsOf(ctx)).toEqual({ 'the knight': 'periodic_classifier' })
  })

  it("credits a term a later update added to that update's source", async () => {
    const ctx = await setup()
    await applyOk(
      ctx,
      createdBy('periodic_classifier', { ...KAEL, keywords: ['the knight'] }),
      'act_c',
    )
    await applyOk(ctx, appended('chapter_close', ['the wanderer']), 'act_a')
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'periodic_classifier',
      'the wanderer': 'chapter_close',
    })
  })

  it('credits a term the user removed and added back to the user', async () => {
    const ctx = await setup()
    await applyOk(
      ctx,
      createdBy('periodic_classifier', { ...KAEL, keywords: ['the knight'] }),
      'act_c',
    )
    await applyOk(ctx, appended('chapter_close', ['the wanderer']), 'act_a')
    await applyOk(ctx, userKeywords(['the knight']), 'act_u1')
    await applyOk(ctx, userKeywords(['the knight', 'The Wanderer']), 'act_u2')
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'periodic_classifier',
      'the wanderer': 'user_edit',
    })
  })

  it('credits a term a pass added back after the user removed it to the pass', async () => {
    const ctx = await setup()
    await applyOk(
      ctx,
      createdBy('user_edit', { ...KAEL, keywords: ['the knight', 'the drunk'] }),
      'act_c',
    )
    await applyOk(ctx, userKeywords(['the knight']), 'act_u')
    await applyOk(ctx, appended('per_turn_classifier', ['the drunk']), 'act_a')
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'user_edit',
      'the drunk': 'per_turn_classifier',
    })
  })

  it('reads a term no delta accounts for as unlogged, as on a wizard or seeded row', async () => {
    const ctx = await setup()
    await ctx.db.insert(entities).values({ ...KAEL, keywords: ['the knight'] })
    await applyOk(ctx, appended('per_turn_classifier', ['the drunk']), 'act_a')
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'unlogged',
      'the drunk': 'per_turn_classifier',
    })
  })

  it("reads a user merge's keyword union as the user's", async () => {
    const ctx = await setup()
    await applyOk(
      ctx,
      createdBy('periodic_classifier', { ...KAEL, keywords: ['the knight'] }),
      'act_c',
    )
    // The loser's flag names the canonical and their names match, so the pair can be merged.
    await ctx.db.insert(entities).values({
      ...KAEL,
      id: 'char_2',
      keywords: ['the stray'],
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_1',
      nameCollisionReason: 'alike',
    })
    const branchEntities = await ctx.db.select().from(entities)
    const lookup = collisionPairOf(branchEntities, ['char_1', 'char_2'])
    if ('miss' in lookup) throw new Error(lookup.miss)
    const merge = entityMergeActions({
      branchId: BRANCH,
      pair: lookup.pair,
      canonicalId: 'char_1',
      fromLoser: [],
      deselectedTags: [],
      deselectedKeywords: [],
      branchEntities,
      happenings: [],
      awareness: [],
      involvements: [],
      relationships: [],
      story: storyPlaceOf({ tail: null, sceneSource: null }),
      tail: null,
      newId: (prefix) => `${prefix}_merge`,
    })
    expect(
      await applyDeltaActionGroup(merge, { actionId: 'act_m', branchId: BRANCH }, ctx),
    ).toEqual({ status: 'ok' })
    expect(await liveKeywords(ctx, 'entities', 'char_1')).toEqual(['the knight', 'the stray'])
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'periodic_classifier',
      'the stray': 'user_edit',
    })
  })

  it("credits a lore term to the user's create and a close's addition to the close", async () => {
    const ctx = await setup()
    await applyOk(
      ctx,
      { kind: 'createLore', source: 'user_edit', payload: { entry: AETHER } },
      'act_c',
    )
    await applyOk(
      ctx,
      {
        kind: 'updateLore',
        source: 'chapter_close',
        payload: {
          branchId: BRANCH,
          id: 'lore_1',
          patch: { keywords: ['aether', 'Ley line'] },
          proseEntryId: null,
        },
      },
      'act_u',
    )
    expect(await authorsOf(ctx, 'lore', 'lore_1')).toEqual({
      aether: 'user_edit',
      'ley line': 'chapter_close',
    })
  })

  it('passes over an update that left the keywords alone', async () => {
    const ctx = await setup()
    await applyOk(ctx, createdBy('user_edit', { ...KAEL, keywords: ['the knight'] }), 'act_c')
    await applyOk(
      ctx,
      {
        kind: 'updateEntityVisualState',
        source: 'per_turn_classifier',
        payload: { branchId: BRANCH, id: 'char_1', visual: { attire: 'a sodden cloak' } },
      },
      'act_v',
    )
    expect(await authorsOf(ctx)).toEqual({ 'the knight': 'user_edit' })
  })

  it('passes over a delete, whose whole-row payload carries keywords too', async () => {
    const ctx = await setup()
    await applyOk(ctx, createdBy('user_edit', { ...KAEL, keywords: ['the knight'] }), 'act_c')
    await applyOk(ctx, appended('chapter_close', ['the wanderer']), 'act_a')
    // Read as an update, this list would end the append's after-list without its term.
    await ctx.runInTransaction([
      deltaRowOp(ctx, {
        deltaId: 'delta_delete',
        branchId: BRANCH,
        entryId: null,
        actionId: 'act_d',
        source: 'user_edit',
        target: {
          targetTable: 'entities',
          targetId: 'char_1',
          op: 'delete',
          undoPayload: { id: 'char_1', name: 'Kael', keywords: ['the knight'] },
        },
      }),
    ])
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'user_edit',
      'the wanderer': 'chapter_close',
    })
  })

  // An undone update leaves the log, so its term falls back to an earlier writer: the known gap.
  it("credits a term a pruned machine update added to the create's source", async () => {
    const ctx = await setup()
    await applyOk(
      ctx,
      createdBy('periodic_classifier', { ...KAEL, keywords: ['the knight'] }),
      'act_c',
    )
    await applyOk(ctx, userKeywords([]), 'act_u1')
    await applyOk(ctx, appended('per_turn_classifier', ['the knight']), 'act_m')
    await applyOk(ctx, userKeywords(['the knight', 'the drunk']), 'act_u2')
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'per_turn_classifier',
      'the drunk': 'user_edit',
    })
    await reverseReplayDeltas('act_m', ctx)
    expect(await liveKeywords(ctx, 'entities', 'char_1')).toEqual(['the knight', 'the drunk'])
    expect(await authorsOf(ctx)).toEqual({
      'the knight': 'periodic_classifier',
      'the drunk': 'user_edit',
    })
  })
})

// classifier.md → Names: a rename keeps the old name as a keyword, which isn't the rename's word.
describe('keywordAuthors: a name a rename demoted', () => {
  const renamed = (name: string): PipelineAction => ({
    kind: 'renameEntity',
    source: 'periodic_classifier',
    payload: { branchId: BRANCH, id: 'char_1', name, proseEntryId: null },
  })

  const userRenamed = (name: string, keywords?: string[]): PipelineAction => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: BRANCH, id: 'char_1', patch: { name, ...(keywords ? { keywords } : {}) } },
  })

  const closeRemoves = (remove: string[]): PipelineAction => ({
    kind: 'setEntityKeywords',
    source: 'chapter_close',
    payload: { branchId: BRANCH, id: 'char_1', add: [], remove, proseEntryId: null },
  })

  it("credits the user's name a classifier rename demoted to the user, so a close can't remove it", async () => {
    const ctx = await setup()
    await applyOk(ctx, createdBy('user_edit', KAEL), 'act_c')
    await applyOk(ctx, renamed('Ser Kael Stormborn'), 'act_r')
    expect(await liveKeywords(ctx, 'entities', 'char_1')).toEqual(['Kael'])
    expect(await authorsOf(ctx)).toEqual({ kael: 'user_edit' })

    const removal = await applyDeltaAction(
      { action: closeRemoves(['Kael']), actionId: 'act_close', branchId: BRANCH },
      ctx,
    )
    expect(removal).toMatchObject({ status: 'rejected', reason: keywordUserAddedReason('Kael') })
    expect(await liveKeywords(ctx, 'entities', 'char_1')).toEqual(['Kael'])
  })

  it("keeps a classifier's own name, demoted by its rename, the pass's", async () => {
    const ctx = await setup()
    await applyOk(ctx, createdBy('periodic_classifier', KAEL), 'act_c')
    await applyOk(ctx, renamed('Ser Kael Stormborn'), 'act_r')
    expect(await authorsOf(ctx)).toEqual({ kael: 'periodic_classifier' })
  })

  it('credits a name the user gave in World, then a rename demoted, to the user', async () => {
    const ctx = await setup()
    await applyOk(ctx, createdBy('periodic_classifier', KAEL), 'act_c')
    await applyOk(ctx, userRenamed('Brother Kael'), 'act_u')
    await applyOk(ctx, renamed('Ser Kael Stormborn'), 'act_r')
    expect(await liveKeywords(ctx, 'entities', 'char_1')).toEqual(['Brother Kael'])
    expect(await authorsOf(ctx)).toEqual({ 'brother kael': 'user_edit' })
  })

  it('credits each of two renames in a row to the writer of the name it demoted', async () => {
    const ctx = await setup()
    await applyOk(ctx, createdBy('user_edit', KAEL), 'act_c')
    await applyOk(ctx, renamed('Ser Kael Stormborn'), 'act_r1')
    await applyOk(ctx, renamed('Lord Stormborn'), 'act_r2')
    expect(await liveKeywords(ctx, 'entities', 'char_1')).toEqual(['Kael', 'Ser Kael Stormborn'])
    expect(await authorsOf(ctx)).toEqual({
      kael: 'user_edit',
      'ser kael stormborn': 'periodic_classifier',
    })
  })

  it("keeps a term the user's own rename kept as a keyword the user's", async () => {
    const ctx = await setup()
    await applyOk(ctx, createdBy('periodic_classifier', KAEL), 'act_c')
    await applyOk(ctx, userRenamed('Ser Kael', ['Kael']), 'act_u')
    expect(await authorsOf(ctx)).toEqual({ kael: 'user_edit' })
  })
})

describe('protectedKeywordTerms', () => {
  it("holds the user's terms and the unlogged ones, never a pass's", async () => {
    const ctx = await setup()
    await ctx.db.insert(entities).values({ ...KAEL, keywords: ['the knight'] })
    await applyOk(ctx, appended('per_turn_classifier', ['the drunk']), 'act_a')
    await applyOk(ctx, userKeywords(['the knight', 'the drunk', 'Ser Kael']), 'act_u')
    const live = await liveKeywords(ctx, 'entities', 'char_1')
    const guarded = await protectedKeywordTerms(ctx, BRANCH, 'entities', 'char_1', live)
    expect([...guarded].sort()).toEqual(['ser kael', 'the knight'])
  })

  // After a fork both branches hold char_1, each with its own log.
  it("reads only its own branch's log: another branch's append credits nothing here", async () => {
    const ctx = await setup()
    await ctx.db
      .insert(branches)
      .values({ id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 2 })
    await applyOk(ctx, createdBy('user_edit', { ...KAEL, keywords: ['the knight'] }), 'act_c')
    const onFork = async (action: PipelineAction, actionId: string) => {
      const result = await applyDeltaAction({ action, actionId, branchId: 'br_2' }, ctx)
      if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
    }
    await onFork(
      createdBy('periodic_classifier', { ...KAEL, branchId: 'br_2', keywords: [] }),
      'act_fork_c',
    )
    await onFork(
      {
        kind: 'appendEntityKeywords',
        source: 'per_turn_classifier',
        payload: { branchId: 'br_2', id: 'char_1', keywords: ['the knight'], proseEntryId: null },
      },
      'act_fork_a',
    )
    const guarded = await protectedKeywordTerms(ctx, BRANCH, 'entities', 'char_1', ['the knight'])
    expect([...guarded]).toEqual(['the knight'])
  })
})

describe('keyword refusal reasons', () => {
  it('name the term as given', () => {
    expect(keywordUserAddedReason('Ser Kael')).toBe('keyword-user-added: Ser Kael')
    expect(keywordPairsFlagReason('Mira', 'Mira')).toBe(
      'keyword-pairs-flag: Mira (pairs this row with Mira, an open question for the user)',
    )
  })
})
