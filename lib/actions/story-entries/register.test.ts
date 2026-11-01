import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { applyDeltaAction, reverseReplayDeltas } from '@/lib/actions'
import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { promptProse } from '@/lib/piggyback'
import { entriesStore } from '@/lib/stores'
import { countTokens } from '@/lib/tokens'

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
    expect(entriesStore.getById('e1')?.content).toBe('hi')
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
    expect(entriesStore.getById('e1')?.metadata?.worldTime).toBe(42)
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
      expect(entriesStore.getById('e1')?.contentTokens).toBe(countTokens(PROSE))
    },
  )

  it('counts the content whatever count the payload holds', async () => {
    const row = await createEntry('ai_reply', { contentTokens: 999999 })
    expect(row.contentTokens).toBe(countTokens(PROSE))
    expect(entriesStore.getById('e1')?.contentTokens).toBe(countTokens(PROSE))
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
    expect(entriesStore.getById('e1')).toBeUndefined()

    await reverseReplayDeltas('act_d', ctx)
    const [restored] = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'e1')))
    expect(restored).toEqual(entry)
    expect(entriesStore.getById('e1')).toEqual(entry)
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

  // Slice "Kind coverage": user_action / ai_reply / system are created + deleted
  // like any entry (the system stub's UI vocabulary lands with later consumers).
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
      expect(entriesStore.getById('e1')).toEqual(entry)
    },
  )
})
