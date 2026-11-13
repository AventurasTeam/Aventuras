import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, lore, stories, type NewLore } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { loreStore } from '@/lib/stores'

import { registerLore } from './register'
import { applyDeltaAction, applyDeltaActionGroupWithOutcomes } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import type { DeltaSource, PipelineAction } from '../types'

async function setup() {
  // Registration is process-global; reset so only lore is live for this test.
  __resetRegistry()
  registerLore()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  loreStore.__reset()
  loreStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const LORE: NewLore = {
  id: 'lore_1',
  branchId: 'br_1',
  title: 'Aether',
  body: 'The magic that binds.',
  category: 'magic',
  tags: ['magic', 'core'],
  keywords: ['aether', 'mana'],
  injectionMode: 'auto',
  priority: 10,
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(lore).where(eq(lore.id, id))
  return r
}

describe('lore CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether')
    expect(loreStore.getById('lore_1')?.keywords).toEqual(['aether', 'mana'])
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    loreStore.hydrate('br_2', []) // store now holds br_2, not br_1
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether') // DB written
    expect(loreStore.getById('lore_1')).toBeUndefined() // store no-op
  })

  it('rejects an empty-set update (no updatable fields → no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'lore_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    // A malformed patch is a hard rejection, not the changed-nothing noop code.
    expect(result.status === 'rejected' && result.code).not.toBe('noop')
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether') // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  // Drizzle skips an undefined key, so committing would leave the row as it was while the
  // store, the undo payload and History recorded a write.
  it('refuses a column set to undefined, and codes a missing row as not-found', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'user_edit', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const update = (id: string, patch: Record<string, unknown>) =>
      applyDeltaAction(
        {
          action: {
            kind: 'updateLore',
            source: 'user_edit',
            payload: { branchId: 'br_1', id, patch },
          },
          actionId: 'act_u',
          branchId: 'br_1',
        },
        ctx,
      )

    expect(await update('lore_1', { title: undefined, priority: 7 })).toMatchObject({
      status: 'rejected',
    })
    expect((await rowFor(db, 'lore_1')).priority).toEqual(10)
    expect(loreStore.getById('lore_1')?.title).toBe('Aether')
    expect((await db.select().from(deltas)).length).toBe(1)
    expect(await update('lore_9', { priority: 7 })).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
  })

  it('rejects an out-of-range priority on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad: NewLore = { ...LORE, priority: 200 }
    const result = await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'lore_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('update on a whole-array column + scalar produces whole-value undo; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'lore_1',
            patch: {
              tags: ['magic', 'core', 'arcane'], // whole-array change
              keywords: ['aether'], // whole-array change (shrink)
              priority: 50, // scalar change
            },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    // forward applied to DB + store
    expect((await rowFor(db, 'lore_1')).priority).toBe(50)
    expect(loreStore.getById('lore_1')?.tags).toEqual(['magic', 'core', 'arcane'])

    // reverse-replay restores the whole prior arrays + scalar
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'lore_1')
    expect(back.priority).toBe(10)
    expect(back.tags).toEqual(['magic', 'core'])
    expect(back.keywords).toEqual(['aether', 'mana'])
    expect(loreStore.getById('lore_1')?.tags).toEqual(['magic', 'core'])
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteLore',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'lore_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'lore_1')).toBeUndefined()
    expect(loreStore.getById('lore_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether')
    expect(loreStore.getById('lore_1')?.title).toBe('Aether')
  })

  it('defaults embedding_stale to 1 on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).embeddingStale).toBe(1)
  })

  it('flips embedding_stale only when an embedded column changes', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createLore',
          source: 'lore_agent',
          payload: { entry: { ...LORE, embeddingStale: 0 } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'lore_1', patch: { category: 'astral' } },
        },
        actionId: 'act_u1',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).embeddingStale).toBe(0) // non-embedded columns don't flip

    await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'lore_1', patch: { title: 'Aether' } },
        },
        actionId: 'act_u2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).embeddingStale).toBe(0) // same value re-sent compares equal

    await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'lore_1', patch: { body: 'new text' } },
        },
        actionId: 'act_u3',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).embeddingStale).toBe(1) // embedded column changed
  })
})

// chapter-close.md → 3a "Existing rows too": a close extends or corrects a row's keywords.
describe('setLoreKeywords', () => {
  type Ctx = Awaited<ReturnType<typeof setup>>['ctx']
  const LANDED = { status: 'landed' }

  const setKeywords = (add: string[], remove: string[]): PipelineAction => ({
    kind: 'setLoreKeywords',
    source: 'chapter_close',
    payload: { branchId: 'br_1', id: 'lore_1', add, remove, proseEntryId: null },
  })

  const closeBody = (body: string): PipelineAction => ({
    kind: 'updateLore',
    source: 'chapter_close',
    payload: { branchId: 'br_1', id: 'lore_1', patch: { body }, proseEntryId: null },
  })

  async function createdBy(ctx: Ctx, source: DeltaSource) {
    const result = await applyDeltaAction(
      {
        action: { kind: 'createLore', source, payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('ok')
  }

  // The group path keeps a noop's mark, which the single path drops.
  async function outcomesOf(ctx: Ctx, actions: PipelineAction[], actionId = 'act_k') {
    const result = await applyDeltaActionGroupWithOutcomes(
      actions,
      { actionId, branchId: 'br_1' },
      ctx,
    )
    if (result.status !== 'ok') throw new Error(`group refused: ${result.reason}`)
    return result.outcomes
  }

  it('adds and removes in one delta, the kept terms first, and reverses', async () => {
    const { db, ctx } = await setup()
    await createdBy(ctx, 'lore_agent')
    expect(await outcomesOf(ctx, [setKeywords(['ley line'], ['MANA'])])).toStrictEqual([LANDED])
    expect((await rowFor(db, 'lore_1')).keywords).toEqual(['aether', 'ley line'])
    expect(loreStore.getById('lore_1')?.keywords).toEqual(['aether', 'ley line'])
    const [delta] = await db.select().from(deltas).where(eq(deltas.actionId, 'act_k'))
    expect(delta.undoPayload).toEqual({ keywords: ['aether', 'mana'] })
    expect(await reverseReplayDeltas('act_k', ctx)).toBe(1)
    expect((await rowFor(db, 'lore_1')).keywords).toEqual(['aether', 'mana'])
  })

  it('refuses to remove a term the user added, naming it, and writes nothing', async () => {
    const { db, ctx } = await setup()
    await createdBy(ctx, 'user_edit')
    expect(await outcomesOf(ctx, [setKeywords(['ley line'], ['mana'])])).toStrictEqual([
      { status: 'noop', reason: 'keyword-user-added: mana' },
    ])
    expect((await rowFor(db, 'lore_1')).keywords).toEqual(['aether', 'mana'])
    expect((await db.select().from(deltas)).length).toBe(1)
  })

  it("removes a term a close added to the user's row", async () => {
    const { db, ctx } = await setup()
    await createdBy(ctx, 'user_edit')
    expect(await outcomesOf(ctx, [setKeywords(['ley line'], [])], 'act_k1')).toStrictEqual([LANDED])
    expect(await outcomesOf(ctx, [setKeywords([], ['Ley Line'])], 'act_k2')).toStrictEqual([LANDED])
    expect((await rowFor(db, 'lore_1')).keywords).toEqual(['aether', 'mana'])
  })

  it('refuses to remove a term on a row no create delta logged, as a wizard row', async () => {
    const { db, ctx } = await setup()
    await db.insert(lore).values(LORE)
    expect(await outcomesOf(ctx, [setKeywords([], ['aether'])])).toStrictEqual([
      { status: 'noop', reason: 'keyword-user-added: aether' },
    ])
    expect((await rowFor(db, 'lore_1')).keywords).toEqual(['aether', 'mana'])
  })

  it('restates a call that changes nothing, marked restated', async () => {
    const { db, ctx } = await setup()
    await createdBy(ctx, 'lore_agent')
    expect(await outcomesOf(ctx, [setKeywords([' AETHER '], ['the ghost'])])).toStrictEqual([
      { status: 'noop', reason: 'no-keyword-change', mark: 'restated' },
    ])
    expect((await db.select().from(deltas)).length).toBe(1)
  })

  it('no-ops on a row that is gone, marked gone', async () => {
    const { ctx } = await setup()
    expect(await outcomesOf(ctx, [setKeywords(['ley line'], [])])).toStrictEqual([
      { status: 'noop', reason: 'keyword target lore br_1:lore_1 not found', mark: 'gone' },
    ])
  })

  it('lands beside an updateLore of the text fields in one group, as two deltas', async () => {
    const { db, ctx } = await setup()
    await createdBy(ctx, 'lore_agent')
    expect(
      await outcomesOf(ctx, [
        closeBody('The magic that binds, and the tithe it takes.'),
        setKeywords(['ley line'], []),
      ]),
    ).toStrictEqual([LANDED, LANDED])
    const row = await rowFor(db, 'lore_1')
    expect(row.body).toBe('The magic that binds, and the tithe it takes.')
    expect(row.keywords).toEqual(['aether', 'mana', 'ley line'])
    expect((await db.select().from(deltas).where(eq(deltas.actionId, 'act_k'))).length).toBe(2)
  })

  it('lands the text fields when the same group refuses the removal', async () => {
    const { db, ctx } = await setup()
    await createdBy(ctx, 'user_edit')
    expect(
      await outcomesOf(ctx, [
        closeBody('The magic that binds, and the tithe it takes.'),
        setKeywords([], ['mana']),
      ]),
    ).toStrictEqual([LANDED, { status: 'noop', reason: 'keyword-user-added: mana' }])
    const row = await rowFor(db, 'lore_1')
    expect(row.body).toBe('The magic that binds, and the tithe it takes.')
    expect(row.keywords).toEqual(['aether', 'mana'])
  })
})
