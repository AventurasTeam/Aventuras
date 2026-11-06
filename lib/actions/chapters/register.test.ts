import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, chapters, deltas, stories, type CloseReport, type NewChapter } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { chaptersStore } from '@/lib/stores'

import { registerChapters } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  // Registration is process-global; reset so only chapters is live for this test.
  __resetRegistry()
  registerChapters()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  chaptersStore.__reset()
  chaptersStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const CHAPTER: NewChapter = {
  id: 'chap_1',
  branchId: 'br_1',
  sequenceNumber: 1,
  title: 'The Gathering Storm',
  summary: 'Heroes assemble as war looms.',
  theme: 'rising tension',
  keywords: ['war', 'omen'],
  startEntryId: 'se_1',
  endEntryId: 'se_40',
  tokenCount: 24000,
  closedAt: 100,
  createdAt: 1,
  updatedAt: 1,
}

const REPORT: CloseReport = {
  version: 1,
  actionId: 'act_c',
  calls: [],
  stopped: [],
  noToolCalls: true,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(chapters).where(eq(chapters.id, id))
  return r
}

describe('chapters CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).title).toBe('The Gathering Storm')
    expect(chaptersStore.getById('chap_1')?.keywords).toEqual(['war', 'omen'])
    expect(chaptersStore.getBySequenceNumber(1)?.id).toBe('chap_1')
  })

  it('create writes a close report into the row, and null when the entry has none', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createChapter',
          source: 'chapter_close',
          payload: { entry: { ...CHAPTER, closeReport: REPORT } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'createChapter',
          source: 'chapter_close',
          payload: { entry: { ...CHAPTER, id: 'chap_2', sequenceNumber: 2 } },
        },
        actionId: 'act_c2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).closeReport).toEqual(REPORT)
    expect((await rowFor(db, 'chap_2')).closeReport).toBeNull()
  })

  it('rejects a malformed close report on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad = { ...CHAPTER, closeReport: { version: 1 } } as unknown as NewChapter
    const result = await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'chap_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    chaptersStore.hydrate('br_2', []) // store now holds br_2, not br_1
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).title).toBe('The Gathering Storm') // DB written
    expect(chaptersStore.getById('chap_1')).toBeUndefined() // store no-op
  })

  it('rejects a non-string keyword on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad = { ...CHAPTER, keywords: [123] } as unknown as NewChapter
    const result = await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'chap_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  // A chapter's number, range and token snapshot are fixed at its close; closed_at never moves.
  it('rejects an update whose patch has only fixed columns (no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    // Each parses against chapterWriteSchema, so only UPDATABLE can refuse them.
    const fixed = {
      sequenceNumber: 2,
      startEntryId: 'se_2',
      endEntryId: 'se_41',
      tokenCount: 26000,
      closedAt: 999,
    }
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'chap_1', patch: fixed as never },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result).toEqual({
      status: 'rejected',
      reason: 'update patch for chapters br_1:chap_1 has no updatable fields',
    })
    expect(await rowFor(db, 'chap_1')).toMatchObject({
      sequenceNumber: 1,
      startEntryId: 'se_1',
      endEntryId: 'se_40',
      tokenCount: 24000,
      closedAt: 100,
    })
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  it('update on keywords (whole-array) + scalar fields; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'chap_1',
            patch: {
              keywords: ['war'], // whole-array change (shrink)
              title: 'War Breaks',
              summary: 'War has come.',
              theme: 'open war',
            },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    expect((await rowFor(db, 'chap_1')).title).toBe('War Breaks')
    expect(chaptersStore.getById('chap_1')?.keywords).toEqual(['war'])

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'chap_1')
    expect(back.title).toBe('The Gathering Storm')
    expect(back.summary).toBe('Heroes assemble as war looms.')
    expect(back.theme).toBe('rising tension')
    expect(back.keywords).toEqual(['war', 'omen'])
    expect(chaptersStore.getById('chap_1')?.keywords).toEqual(['war', 'omen'])
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteChapter',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'chap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'chap_1')).toBeUndefined()
    expect(chaptersStore.getById('chap_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'chap_1')).title).toBe('The Gathering Storm')
    expect(chaptersStore.getById('chap_1')?.title).toBe('The Gathering Storm')
  })

  it('defaults embedding_stale to 1 on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).embeddingStale).toBe(1)
  })

  it('flips embedding_stale only when an embedded column changes', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createChapter',
          source: 'chapter_close',
          payload: { entry: { ...CHAPTER, embeddingStale: 0 } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'chap_1', patch: { title: 'War Breaks' } },
        },
        actionId: 'act_u1',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).embeddingStale).toBe(0) // non-embedded columns don't flip

    await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'chap_1',
            patch: { summary: 'Heroes assemble as war looms.' },
          },
        },
        actionId: 'act_u2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).embeddingStale).toBe(0) // resubmitting an unchanged value compares equal

    await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'chap_1', patch: { theme: 'new theme' } },
        },
        actionId: 'act_u3',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).embeddingStale).toBe(1) // embedded column changed
  })
})

// Milestone C4: the store row is the DB row less `closeReport`, plus `hasCloseReport`.
describe('chapters store projection', () => {
  async function expectStoreMirrors(
    db: Awaited<ReturnType<typeof setup>>['db'],
    hasCloseReport: boolean,
  ) {
    const stored = chaptersStore.getById('chap_1')
    expect(stored).toBeDefined()
    const { hasCloseReport: flag, ...storeRest } = stored!
    const { closeReport: _closeReport, ...dbRest } = await rowFor(db, 'chap_1')
    expect(storeRest).toEqual(dbRest)
    expect(flag).toBe(hasCloseReport)
  }

  async function createWith(ctx: Awaited<ReturnType<typeof setup>>['ctx'], entry: NewChapter) {
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
  }

  async function updateWith(
    ctx: Awaited<ReturnType<typeof setup>>['ctx'],
    write: {
      actionId: string
      source: 'chapter_close' | 'user_edit'
      patch: { title?: string; closeReport?: CloseReport | null }
    },
  ) {
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: write.source,
          payload: { branchId: 'br_1', id: 'chap_1', patch: write.patch },
        },
        actionId: write.actionId,
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('ok')
  }

  it('flags a created row by whether it carries a report', async () => {
    const { db, ctx } = await setup()
    await createWith(ctx, { ...CHAPTER, closeReport: REPORT })
    await expectStoreMirrors(db, true)
  })

  it('flags the report update, and clears the flag when it is reversed', async () => {
    const { db, ctx } = await setup()
    await createWith(ctx, CHAPTER)
    await expectStoreMirrors(db, false)
    await updateWith(ctx, {
      actionId: 'act_report',
      source: 'chapter_close',
      patch: { closeReport: REPORT },
    })
    expect((await rowFor(db, 'chap_1')).closeReport).toEqual(REPORT)
    await expectStoreMirrors(db, true)
    expect(await reverseReplayDeltas('act_report', ctx)).toBe(1)
    expect((await rowFor(db, 'chap_1')).closeReport).toBeNull()
    await expectStoreMirrors(db, false)
  })

  it('leaves the flag alone through a title save and its reversal', async () => {
    const { db, ctx } = await setup()
    await createWith(ctx, { ...CHAPTER, closeReport: REPORT })
    await updateWith(ctx, {
      actionId: 'act_title',
      source: 'user_edit',
      patch: { title: 'War Breaks' },
    })
    await expectStoreMirrors(db, true)
    expect(await reverseReplayDeltas('act_title', ctx)).toBe(1)
    await expectStoreMirrors(db, true)
  })

  // Drizzle skips an undefined key, so letting one through would flag the store without writing.
  it.each([
    ['beside another column', { title: 'New', closeReport: undefined }],
    ['alone', { closeReport: undefined }],
  ])(
    'rejects an undefined report %s (no write, no flag change, no delta)',
    async (_name, patch) => {
      const { db, ctx } = await setup()
      await createWith(ctx, { ...CHAPTER, closeReport: REPORT })
      const result = await applyDeltaAction(
        {
          action: {
            kind: 'updateChapter',
            source: 'chapter_close',
            payload: { branchId: 'br_1', id: 'chap_1', patch },
          },
          actionId: 'act_undef',
          branchId: 'br_1',
        },
        ctx,
      )
      expect(result).toEqual({
        status: 'rejected',
        reason: 'invalid chapter patch: closeReport is undefined',
      })
      expect((await rowFor(db, 'chap_1')).closeReport).toEqual(REPORT)
      await expectStoreMirrors(db, true)
      expect((await db.select().from(deltas)).length).toBe(1)
    },
  )

  it('rejects a malformed report on update (no write, no delta)', async () => {
    const { db, ctx } = await setup()
    await createWith(ctx, CHAPTER)
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'chapter_close',
          payload: {
            branchId: 'br_1',
            id: 'chap_1',
            patch: { closeReport: { version: 1 } as unknown as CloseReport },
          },
        },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'chap_1')).closeReport).toBeNull()
    expect((await db.select().from(deltas)).length).toBe(1)
  })
})
