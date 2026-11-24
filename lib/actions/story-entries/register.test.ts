import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { applyDeltaAction, reverseReplayDeltas, type PipelineAction } from '@/lib/actions'
import { branches, deltas, stories, storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { promptProse } from '@/lib/piggyback'
import { entriesStore } from '@/lib/stores'
import { countTokens } from '@/lib/tokens'

import { isContentEditDelta } from './classifier-facts'

afterEach(() => entriesStore.__reset())

async function seed(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
}

describe('story_entries patcher', () => {
  it('mirrors a create into the held entries store', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    entriesStore.hydrate('b1', [])
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'e1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
              createdAt: 1,
            },
          },
        },
        actionId: 'act_1',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    expect(entriesStore.getById('b1', 'e1')?.content).toBe('hi')
  })

  it('mirrors a metadata update into the held entries store', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    entriesStore.hydrate('b1', [])
    const baseMeta = { sceneEntities: [], currentLocationId: null, worldTime: 0 }
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: 'e1',
              branchId: 'b1',
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              metadata: baseMeta,
              createdAt: 1,
            },
          },
        },
        actionId: 'act_c',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'user_edit',
          payload: {
            branchId: 'b1',
            id: 'e1',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 42 },
          },
        },
        actionId: 'act_u',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    expect(entriesStore.getById('b1', 'e1')?.metadata?.worldTime).toBe(42)
  })
})

describe('content_tokens at create', () => {
  const PROSE = 'The courier rode north before the snow closed the pass.'

  async function createEntry(
    kind: 'user_action' | 'ai_reply',
    overrides: { content?: string; contentTokens?: number } = {},
  ) {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    entriesStore.hydrate('b1', [])
    await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'user_edit',
          payload: {
            entry: {
              id: 'e1',
              branchId: 'b1',
              position: 1,
              kind,
              content: PROSE,
              createdAt: 1,
              ...overrides,
            },
          },
        },
        actionId: 'act_c',
        branchId: 'b1',
        entryId: null,
      },
      { db, runInTransaction },
    )
    const [row] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'e1'))
    return row
  }

  it.each(['user_action', 'ai_reply'] as const)(
    'stores the count of a %s in the row and the store',
    async (kind) => {
      const row = await createEntry(kind)
      expect(row.contentTokens).toBe(countTokens(PROSE))
      expect(entriesStore.getById('b1', 'e1')?.contentTokens).toBe(countTokens(PROSE))
    },
  )

  it('counts the content whatever count the payload holds', async () => {
    const row = await createEntry('ai_reply', { contentTokens: 999999 })
    expect(row.contentTokens).toBe(countTokens(PROSE))
    expect(entriesStore.getById('b1', 'e1')?.contentTokens).toBe(countTokens(PROSE))
  })

  it('counts stored content, not the prose a prompt reads from it', async () => {
    const content = `${PROSE}\n<state>{"sceneEntities":["char_aria"]}</state>`
    const row = await createEntry('ai_reply', { content })
    expect(row.contentTokens).toBe(countTokens(content))
    expect(row.contentTokens).not.toBe(countTokens(promptProse({ kind: 'ai_reply', content })))
  })
})

describe('opening invariants', () => {
  it('rejects creating an opening at a position other than 1', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'user_edit',
          payload: {
            entry: {
              id: 'op1',
              branchId: 'b1',
              position: 3,
              kind: 'opening',
              content: 'once upon a time',
              createdAt: 1,
            },
          },
        },
        actionId: 'act_op',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('opening-position')
  })

  it('allows an opening at position 1', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'user_edit',
          payload: {
            entry: {
              id: 'op1',
              branchId: 'b1',
              position: 1,
              kind: 'opening',
              content: 'once upon a time',
              createdAt: 1,
            },
          },
        },
        actionId: 'act_op',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    expect(result.status).toBe('ok')
  })
})

// Entry ids repeat across branches (the key is branch and id), so every read and write is scoped.
describe('branch scope', () => {
  const main: StoryEntry = {
    id: 'e1',
    branchId: 'b1',
    position: 1,
    kind: 'ai_reply',
    content: 'On main.',
    contentTokens: countTokens('On main.'),
    chapterId: 'chap_main',
    metadata: { sceneEntities: ['char_main'], currentLocationId: 'loc_main', worldTime: 20 },
    createdAt: 1,
  }
  const fork: StoryEntry = {
    id: 'e1',
    branchId: 'b2',
    position: 2,
    kind: 'user_action',
    content: 'On the fork.',
    contentTokens: countTokens('On the fork.'),
    chapterId: 'chap_fork',
    metadata: { sceneEntities: [], currentLocationId: 'loc_fork', worldTime: 10 },
    createdAt: 2,
  }

  async function twoBranches(seeded: readonly StoryEntry[] = [main, fork]) {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 2 })
    await db.insert(storyEntries).values([...seeded])
    const read = async (branchId: string) =>
      (
        await db
          .select()
          .from(storyEntries)
          .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, 'e1')))
      )[0]
    const undoPayloadsOf = async (actionId: string) =>
      (await db.select().from(deltas).where(eq(deltas.actionId, actionId))).map(
        (delta) => delta.undoPayload,
      )
    return { ctx: { db, runInTransaction }, read, undoPayloadsOf }
  }

  const onFork = (ctx: DbCtx, action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'b2', entryId: null }, ctx)

  it("createStoryEntry pair: creates the row on its own branch beside another branch's same id, and its reversal removes only that row", async () => {
    const { ctx, read } = await twoBranches([main])
    const { contentTokens: _counted, ...entry } = fork
    expect(
      await onFork(
        ctx,
        { kind: 'createStoryEntry', source: 'user_edit', payload: { entry } },
        'act_c',
      ),
    ).toMatchObject({ status: 'ok' })
    expect(await read('b2')).toEqual(fork)
    expect(await read('b1')).toEqual(main)

    await reverseReplayDeltas('act_c', ctx)
    expect(await read('b2')).toBeUndefined()
    expect(await read('b1')).toEqual(main)
  })

  it("updateStoryEntryMetadata pair: updates only its own branch's row, merging over that row, and its reversal restores it", async () => {
    const { ctx, read } = await twoBranches()
    const update: PipelineAction = {
      kind: 'updateStoryEntryMetadata',
      source: 'user_edit',
      payload: { branchId: 'b2', id: 'e1', metadata: { worldTime: 99 } },
    }
    expect(await onFork(ctx, update, 'act_u')).toMatchObject({ status: 'ok' })
    expect((await read('b2'))?.metadata).toEqual({
      sceneEntities: [],
      currentLocationId: 'loc_fork',
      worldTime: 99,
    })
    expect(await read('b1')).toEqual(main)

    await reverseReplayDeltas('act_u', ctx)
    expect(await read('b2')).toEqual(fork)
    expect(await read('b1')).toEqual(main)
  })

  it("stampEntryChapter pair: stamps only its own branch's row, recording that row's chapter, and its reversal restores it", async () => {
    const { ctx, read, undoPayloadsOf } = await twoBranches()
    const stamp: PipelineAction = {
      kind: 'stampEntryChapter',
      source: 'chapter_close',
      payload: { branchId: 'b2', id: 'e1', chapterId: 'chap_new' },
    }
    expect(await onFork(ctx, stamp, 'act_s')).toMatchObject({ status: 'ok' })
    expect(await read('b2')).toEqual({ ...fork, chapterId: 'chap_new' })
    expect(await read('b1')).toEqual(main)
    expect(await undoPayloadsOf('act_s')).toEqual([{ chapterId: 'chap_fork' }])

    await reverseReplayDeltas('act_s', ctx)
    expect(await read('b2')).toEqual(fork)
    expect(await read('b1')).toEqual(main)
  })

  it("deleteStoryEntry pair: deletes only its own branch's row, and its reversal restores that row", async () => {
    const { ctx, read } = await twoBranches()
    const remove: PipelineAction = {
      kind: 'deleteStoryEntry',
      source: 'user_edit',
      payload: { branchId: 'b2', id: 'e1' },
    }
    expect(await onFork(ctx, remove, 'act_d')).toMatchObject({ status: 'ok' })
    expect(await read('b2')).toBeUndefined()
    expect(await read('b1')).toEqual(main)

    await reverseReplayDeltas('act_d', ctx)
    expect(await read('b2')).toEqual(fork)
    expect(await read('b1')).toEqual(main)
  })

  const PAYLOAD_CASES: { kind: string; action: PipelineAction; reason: string }[] = [
    {
      kind: 'createStoryEntry',
      action: {
        kind: 'createStoryEntry',
        source: 'user_edit',
        payload: {
          entry: {
            id: 'e2',
            branchId: 'b1',
            position: 2,
            kind: 'ai_reply',
            content: 'Elsewhere.',
            createdAt: 3,
          },
        },
      },
      reason: 'branch mismatch: delta branch b2 vs entry branch b1',
    },
    {
      kind: 'updateStoryEntryMetadata',
      action: {
        kind: 'updateStoryEntryMetadata',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'e1', metadata: { worldTime: 99 } },
      },
      reason: 'branch mismatch: delta branch b2 vs target branch b1',
    },
    {
      kind: 'stampEntryChapter',
      action: {
        kind: 'stampEntryChapter',
        source: 'chapter_close',
        payload: { branchId: 'b1', id: 'e1', chapterId: 'chap_new' },
      },
      reason: 'branch mismatch: delta branch b2 vs target branch b1',
    },
    {
      kind: 'deleteStoryEntry',
      action: {
        kind: 'deleteStoryEntry',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'e1' },
      },
      reason: 'branch mismatch: delta branch b2 vs target branch b1',
    },
  ]

  it.each(PAYLOAD_CASES)(
    '$kind payload: refuses a payload naming another branch and writes neither branch',
    async ({ action, reason }) => {
      const { ctx, read, undoPayloadsOf } = await twoBranches()
      expect(await onFork(ctx, action, 'act_p')).toEqual({ status: 'rejected', reason })
      expect(await read('b1')).toEqual(main)
      expect(await read('b2')).toEqual(fork)
      expect(await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'e2'))).toEqual([])
      expect(await undoPayloadsOf('act_p')).toEqual([])
    },
  )
})

describe('deleteStoryEntry arm', () => {
  it('round-trips create -> delete -> reverse byte-identical and reappears in the store', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    entriesStore.hydrate('b1', [])
    const entry = {
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply' as const,
      content: 'hi',
      contentTokens: countTokens('hi'),
      chapterId: null,
      metadata: { sceneEntities: ['ent_a'], currentLocationId: 'loc_1', worldTime: 7 },
      createdAt: 1,
    }
    await applyDeltaAction(
      {
        action: { kind: 'createStoryEntry', source: 'ai_classifier', payload: { entry } },
        actionId: 'act_c',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteStoryEntry',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'e1' },
        },
        actionId: 'act_d',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    expect(
      (
        await db
          .select()
          .from(storyEntries)
          .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))
      ).length,
    ).toBe(0)
    expect(entriesStore.getById('b1', 'e1')).toBeUndefined()

    await reverseReplayDeltas('act_d', ctx)
    const [restored] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))
    expect(restored).toEqual(entry)
    expect(entriesStore.getById('b1', 'e1')).toEqual(entry)
  })

  it('rejects deleting an opening entry', async () => {
    const { db, runInTransaction } = await createTestDb()
    const ctx = { db, runInTransaction }
    await seed(db)
    await db.insert(storyEntries).values({
      id: 'op1',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'o',
      createdAt: 1,
    })
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'deleteStoryEntry',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'op1' },
        },
        actionId: 'act_d',
        branchId: 'b1',
        entryId: null,
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.code).toBe('opening-delete-blocked')
  })

  // user_action, ai_reply and system are created and deleted like any entry.
  it.each(['user_action', 'ai_reply', 'system'] as const)(
    'create -> delete -> reverse round-trips kind=%s',
    async (kind) => {
      const { db, runInTransaction } = await createTestDb()
      const ctx = { db, runInTransaction }
      await seed(db)
      entriesStore.hydrate('b1', [])
      const entry = {
        id: 'e1',
        branchId: 'b1',
        position: 1,
        kind,
        content: 'x',
        contentTokens: countTokens('x'),
        chapterId: null,
        metadata: null,
        createdAt: 1,
      }
      await applyDeltaAction(
        {
          action: { kind: 'createStoryEntry', source: 'user_edit', payload: { entry } },
          actionId: 'act_c',
          branchId: 'b1',
          entryId: null,
        },
        ctx,
      )
      await applyDeltaAction(
        {
          action: {
            kind: 'deleteStoryEntry',
            source: 'user_edit',
            payload: { branchId: 'b1', id: 'e1' },
          },
          actionId: 'act_d',
          branchId: 'b1',
          entryId: null,
        },
        ctx,
      )
      expect(
        (
          await db
            .select()
            .from(storyEntries)
            .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))
        ).length,
      ).toBe(0)
      await reverseReplayDeltas('act_d', ctx)
      const [restored] = await db
        .select()
        .from(storyEntries)
        .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))
      expect(restored).toEqual(entry)
      expect(entriesStore.getById('b1', 'e1')).toEqual(entry)
    },
  )
})

// C1: a close stamps each entry with its own delta, so a reversal restores one row per delta.
describe('stampEntryChapter', () => {
  const PROSE = 'The ferry slid out into the black water, and the lamps of Harrow fell behind.'

  async function stampFixture(prior: string | null): Promise<DbCtx> {
    const { db, runInTransaction } = await createTestDb()
    await seed(db)
    await db.insert(storyEntries).values({
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: PROSE,
      contentTokens: countTokens(PROSE),
      chapterId: prior,
      metadata: { sceneEntities: [], currentLocationId: null, worldTime: 60 },
      createdAt: 1,
    })
    entriesStore.hydrate('b1', await db.select().from(storyEntries))
    return { db, runInTransaction }
  }

  const stamp = (ctx: DbCtx, over: { branchId?: string; id?: string } = {}) =>
    applyDeltaAction(
      {
        action: {
          kind: 'stampEntryChapter',
          source: 'chapter_close',
          payload: { branchId: 'b1', id: 'e1', chapterId: 'chap_new', ...over },
        },
        actionId: 'act_close',
        branchId: 'b1',
        entryId: 'e1',
      },
      ctx,
    )

  const entryRow = async (ctx: DbCtx) =>
    (await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'e1')))[0]
  const closeDeltas = (ctx: DbCtx) =>
    ctx.db.select().from(deltas).where(eq(deltas.actionId, 'act_close'))

  it('writes only chapter_id and records the prior value as its whole undo', async () => {
    const ctx = await stampFixture(null)
    const before = await entryRow(ctx)

    expect(await stamp(ctx)).toMatchObject({ status: 'ok' })

    expect(await entryRow(ctx)).toEqual({ ...before, chapterId: 'chap_new' })
    const [delta] = await closeDeltas(ctx)
    expect(delta).toMatchObject({
      targetTable: 'story_entries',
      targetId: 'e1',
      op: 'update',
      source: 'chapter_close',
      entryId: 'e1',
    })
    expect(delta!.undoPayload).toEqual({ chapterId: null })
    expect(isContentEditDelta(delta!)).toBe(false)
    expect(entriesStore.getById('b1', 'e1')?.chapterId).toBe('chap_new')
  })

  it('restores the chapter the entry held before, on undo', async () => {
    const ctx = await stampFixture('chap_old')
    await stamp(ctx)
    const [delta] = await closeDeltas(ctx)
    expect(delta!.undoPayload).toEqual({ chapterId: 'chap_old' })

    await reverseReplayDeltas('act_close', ctx)

    expect((await entryRow(ctx))!.chapterId).toBe('chap_old')
    expect(entriesStore.getById('b1', 'e1')?.chapterId).toBe('chap_old')
  })

  it('clears the stamp on undo when the entry held none', async () => {
    const ctx = await stampFixture(null)
    expect(await stamp(ctx)).toMatchObject({ status: 'ok' })

    await reverseReplayDeltas('act_close', ctx)

    expect((await entryRow(ctx))!.chapterId).toBeNull()
    expect(entriesStore.getById('b1', 'e1')?.chapterId).toBeNull()
  })

  it('refuses an entry that is not there and logs nothing', async () => {
    const ctx = await stampFixture(null)

    expect(await stamp(ctx, { id: 'e_missing' })).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
    expect(await closeDeltas(ctx)).toEqual([])
  })

  it("stamps only its own branch's row, as entry ids repeat across branches", async () => {
    const ctx = await stampFixture(null)
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await ctx.db.insert(storyEntries).values({
      id: 'e1',
      branchId: 'b2',
      position: 1,
      kind: 'ai_reply',
      content: PROSE,
      contentTokens: countTokens(PROSE),
      chapterId: null,
      metadata: { sceneEntities: [], currentLocationId: null, worldTime: 60 },
      createdAt: 1,
    })

    expect(await stamp(ctx)).toMatchObject({ status: 'ok' })

    const [other] = await ctx.db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b2'), eq(storyEntries.id, 'e1')))
    expect(other!.chapterId).toBeNull()
    expect((await entryRow(ctx))!.chapterId).toBe('chap_new')
  })

  it('refuses a payload naming another branch and writes nothing', async () => {
    const ctx = await stampFixture(null)

    expect(await stamp(ctx, { branchId: 'b2' })).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('branch mismatch'),
    })
    expect((await entryRow(ctx))!.chapterId).toBeNull()
    expect(await closeDeltas(ctx)).toEqual([])
  })
})
