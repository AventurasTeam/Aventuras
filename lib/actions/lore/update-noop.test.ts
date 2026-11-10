import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, lore, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { applyDeltaAction, applyDeltaActionGroupWithOutcomes } from '../delta/apply-delta-action'
import { USER_EDITED_SINCE_PROSE } from '../delta/user-precedence'
import type { DeltaSource, PipelineAction } from '../types'

describe('updateLore', () => {
  it('logs only the columns that changed, and a no-op when none did', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(lore).values({
      id: 'lore_1',
      branchId: 'b1',
      title: 'Vael',
      body: 'A city.',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    const update = (patch: Record<string, unknown>) =>
      applyDeltaAction(
        {
          action: {
            kind: 'updateLore',
            source: 'user_edit',
            payload: { branchId: 'b1', id: 'lore_1', patch, proseEntryId: null },
          },
          actionId: 'a',
          branchId: 'b1',
        },
        ctx,
      )

    expect(await update({ title: 'Vael' })).toMatchObject({ status: 'rejected', code: 'noop' })
    await update({ title: 'Vael', body: 'A port.' })
    const [row] = await db.select().from(deltas)
    expect(row.undoPayload).toEqual({ body: 'A city.' })
  })
})

// cadence.md → User edits and classifier writes: a column the user wrote after the prose stands.
describe("a close's lore writes against the user's edits", () => {
  const PROSE = 'e_prose'
  const userWon = { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }
  type LorePatch = { title?: string; body?: string; category?: string | null; keywords?: string[] }

  async function setup() {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    return { db, ctx: { db, runInTransaction } }
  }
  type Ctx = Awaited<ReturnType<typeof setup>>['ctx']
  type Db = Awaited<ReturnType<typeof setup>>['db']

  const run = (ctx: Ctx, action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)

  // Throws on a refusal, so a setup write that didn't land can't let a test pass vacuously.
  async function ok(ctx: Ctx, action: PipelineAction, actionId: string) {
    const result = await run(ctx, action, actionId)
    if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
  }

  const createLore = (ctx: Ctx, source: DeltaSource = 'lore_agent') =>
    ok(
      ctx,
      {
        kind: 'createLore',
        source,
        payload: {
          entry: {
            id: 'lore_1',
            branchId: 'b1',
            title: 'Vael',
            body: 'A city.',
            keywords: ['vael', 'the tide gate'],
            injectionMode: 'auto',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      'act_c',
    )

  const writeProse = (ctx: Ctx) =>
    ok(
      ctx,
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: PROSE,
            branchId: 'b1',
            position: 1,
            kind: 'ai_reply',
            content: 'The tide gate held through the night.',
            createdAt: 1,
          },
        },
      },
      'act_prose',
    )

  const userEdit = (ctx: Ctx, patch: LorePatch, actionId = 'act_u') =>
    ok(
      ctx,
      {
        kind: 'updateLore',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'lore_1', patch, proseEntryId: null },
      },
      actionId,
    )

  const closeUpdate = (patch: LorePatch): PipelineAction => ({
    kind: 'updateLore',
    source: 'chapter_close',
    payload: { branchId: 'b1', id: 'lore_1', patch, proseEntryId: PROSE },
  })

  const closeKeywords = (add: string[]): PipelineAction => ({
    kind: 'setLoreKeywords',
    source: 'chapter_close',
    payload: { branchId: 'b1', id: 'lore_1', add, remove: [], proseEntryId: PROSE },
  })

  const loreRow = async (db: Db) => (await db.select().from(lore).where(eq(lore.id, 'lore_1')))[0]

  describe('updateLore with a prose entry', () => {
    it('drops a column the user wrote after the prose and lands the rest', async () => {
      const { db, ctx } = await setup()
      await createLore(ctx)
      await writeProse(ctx)
      await userEdit(ctx, { body: 'A port.' })
      expect(
        (await run(ctx, closeUpdate({ body: 'A drowned city.', category: 'place' }), 'act_k'))
          .status,
      ).toBe('ok')
      const row = await loreRow(db)
      expect(row.body).toBe('A port.')
      expect(row.category).toBe('place')
      const logged = await db.select().from(deltas).where(eq(deltas.actionId, 'act_k'))
      expect(logged.map((d) => d.undoPayload)).toEqual([{ category: null }])
    })

    it('skips a patch whose every changed column the user wrote after the prose', async () => {
      const { db, ctx } = await setup()
      await createLore(ctx)
      await writeProse(ctx)
      await userEdit(ctx, { body: 'A port.' })
      expect(await run(ctx, closeUpdate({ body: 'A drowned city.' }), 'act_k')).toEqual(userWon)
      expect((await loreRow(db)).body).toBe('A port.')
    })

    it('writes over a column the user wrote before the prose', async () => {
      const { db, ctx } = await setup()
      await createLore(ctx)
      await userEdit(ctx, { body: 'A port.' })
      await writeProse(ctx)
      expect((await run(ctx, closeUpdate({ body: 'A drowned city.' }), 'act_k')).status).toBe('ok')
      expect((await loreRow(db)).body).toBe('A drowned city.')
    })

    it('reads a restated column as restated, though the user wrote it after the prose', async () => {
      const { ctx } = await setup()
      await createLore(ctx)
      await writeProse(ctx)
      await userEdit(ctx, { body: 'A port.' })
      const result = await applyDeltaActionGroupWithOutcomes(
        [closeUpdate({ body: 'A port.' })],
        { actionId: 'act_k', branchId: 'b1' },
        ctx,
      )
      expect(result).toStrictEqual({
        status: 'ok',
        outcomes: [{ status: 'noop', reason: 'no-op lore patch', mark: 'restated' }],
      })
    })

    it('keeps every column of a row the user created after the prose', async () => {
      const { db, ctx } = await setup()
      await writeProse(ctx)
      await createLore(ctx, 'user_edit')
      expect(await run(ctx, closeUpdate({ category: 'place' }), 'act_k')).toEqual(userWon)
      expect((await loreRow(db)).category).toBeNull()
    })

    it('checks nothing when the prose entry is null', async () => {
      const { db, ctx } = await setup()
      await createLore(ctx)
      await writeProse(ctx)
      await userEdit(ctx, { body: 'A port.' })
      const unanchored: PipelineAction = {
        kind: 'updateLore',
        source: 'chapter_close',
        payload: {
          branchId: 'b1',
          id: 'lore_1',
          patch: { body: 'A drowned city.' },
          proseEntryId: null,
        },
      }
      expect((await run(ctx, unanchored, 'act_k')).status).toBe('ok')
      expect((await loreRow(db)).body).toBe('A drowned city.')
    })
  })

  describe('setLoreKeywords with a prose entry', () => {
    it('keeps out an add the user removed after the prose while the other terms land', async () => {
      const { db, ctx } = await setup()
      await createLore(ctx)
      await writeProse(ctx)
      await userEdit(ctx, { keywords: ['vael'] })
      expect(
        (await run(ctx, closeKeywords(['The Tide Gate', 'the harbour']), 'act_k')).status,
      ).toBe('ok')
      expect((await loreRow(db)).keywords).toEqual(['vael', 'the harbour'])
    })

    it('skips a call whose every add the user removed after the prose', async () => {
      const { db, ctx } = await setup()
      await createLore(ctx)
      await writeProse(ctx)
      await userEdit(ctx, { keywords: ['vael'] })
      expect(await run(ctx, closeKeywords(['the tide gate']), 'act_k')).toEqual(userWon)
      expect((await loreRow(db)).keywords).toEqual(['vael'])
    })
  })
})
