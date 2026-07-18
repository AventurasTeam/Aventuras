import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { emptyWorkingState, stories, wizardSessions } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { storiesStore } from '@/lib/stores'
import { toastStore } from '@/lib/toast'

import {
  clearLiveSession,
  loadDraft,
  loadLiveSession,
  saveLiveSession,
  saveStoryDraft,
  sessionExists,
} from './session'

let ctx: {
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
}

beforeEach(async () => {
  const { db, runInTransaction } = await createTestDb()
  ctx = { db, runInTransaction }
  storiesStore.__reset()
  toastStore.__reset()
})

afterEach(() => {
  ctx = undefined as never
})

describe('wizard session/draft actions', () => {
  it('saveLiveSession upserts the singleton and sessionExists reflects it', async () => {
    expect(await sessionExists(ctx)).toBe(false)
    await saveLiveSession(emptyWorkingState(), ctx, 1)
    expect(await sessionExists(ctx)).toBe(true)
    const rows = await ctx.db.select().from(wizardSessions).where(eq(wizardSessions.id, 'live'))
    expect(rows).toHaveLength(1)
  })

  it('saveLiveSession twice keeps a single live row (idempotent upsert)', async () => {
    await saveLiveSession(emptyWorkingState(), ctx, 1)
    const s2 = emptyWorkingState()
    s2.definition.title = 'changed'
    await saveLiveSession(s2, ctx, 2)
    const rows = await ctx.db.select().from(wizardSessions).where(eq(wizardSessions.id, 'live'))
    expect(rows).toHaveLength(1)
    expect(rows[0].state.definition.title).toBe('changed')
  })

  it('saveStoryDraft creates a draft stories row, persists the blob, and clears the live session', async () => {
    const s = emptyWorkingState()
    s.definition.title = 'Draft title'
    await saveLiveSession(s, ctx, 1)
    const { storyId } = await saveStoryDraft(s, ctx, 2)
    const [story] = await ctx.db.select().from(stories).where(eq(stories.id, storyId))
    expect(story.status).toBe('draft')
    expect(story.title).toBe('Draft title')
    expect(await sessionExists(ctx)).toBe(false)
    const [draftRow] = await ctx.db
      .select()
      .from(wizardSessions)
      .where(eq(wizardSessions.id, storyId))
    expect(draftRow.state.definition.title).toBe('Draft title')
  })

  it('saveStoryDraft with no title uses an Untitled placeholder', async () => {
    const { storyId } = await saveStoryDraft(emptyWorkingState(), ctx, 1)
    const [story] = await ctx.db.select().from(stories).where(eq(stories.id, storyId))
    expect(story.title).toBe('Untitled story')
  })

  it('loadDraft round-trips the persisted working-state', async () => {
    const s = emptyWorkingState()
    s.leadName = 'Aria'
    s.step = 5
    const { storyId } = await saveStoryDraft(s, ctx, 1)
    const loaded = await loadDraft(storyId, ctx)
    expect(loaded?.leadName).toBe('Aria')
    expect(loaded?.step).toBe(5)
  })

  it('clearLiveSession removes only the live singleton', async () => {
    await saveLiveSession(emptyWorkingState(), ctx, 1)
    await clearLiveSession(ctx)
    expect(await sessionExists(ctx)).toBe(false)
  })

  it('loadLiveSession round-trips the persisted live state, and is null once cleared', async () => {
    expect(await loadLiveSession(ctx)).toBeNull()
    const s = emptyWorkingState()
    s.leadName = 'Bran'
    s.step = 2
    await saveLiveSession(s, ctx, 1)
    const loaded = await loadLiveSession(ctx)
    expect(loaded?.state.leadName).toBe('Bran')
    expect(loaded?.state.step).toBe(2)
    expect(loaded?.sourceStoryId).toBeNull()
    await clearLiveSession(ctx)
    expect(await loadLiveSession(ctx)).toBeNull()
  })

  it('saveLiveSession carries a resumed draft id through to loadLiveSession', async () => {
    const s = emptyWorkingState()
    s.definition.title = 'Resumed'
    const { storyId } = await saveStoryDraft(s, ctx, 1)
    await saveLiveSession(s, ctx, 2, storyId)
    const loaded = await loadLiveSession(ctx)
    expect(loaded?.sourceStoryId).toBe(storyId)
  })

  it('saveStoryDraft with an existingStoryId re-saves the same story row', async () => {
    const s = emptyWorkingState()
    s.definition.title = 'First save'
    const { storyId } = await saveStoryDraft(s, ctx, 1)

    const s2 = emptyWorkingState()
    s2.definition.title = 'Second save'
    const { storyId: storyId2 } = await saveStoryDraft(s2, ctx, 2, storyId)

    expect(storyId2).toBe(storyId)
    const storyRows = await ctx.db.select().from(stories).where(eq(stories.id, storyId))
    expect(storyRows).toHaveLength(1)
    expect(storyRows[0].title).toBe('Second save')
    const loaded = await loadDraft(storyId, ctx)
    expect(loaded?.definition.title).toBe('Second save')
  })

  it('saveStoryDraft re-save preserves the original createdAt', async () => {
    const { storyId } = await saveStoryDraft(emptyWorkingState(), ctx, 1)
    await saveStoryDraft(emptyWorkingState(), ctx, 999, storyId)
    const [story] = await ctx.db.select().from(stories).where(eq(stories.id, storyId))
    expect(story.createdAt).toBe(1)
    expect(story.updatedAt).toBe(999)
  })

  it('saveStoryDraft writes the card-backing definition and description', async () => {
    const s = emptyWorkingState()
    s.definition.description = 'A tale of woe'
    const { storyId } = await saveStoryDraft(s, ctx, 1)
    const [story] = await ctx.db.select().from(stories).where(eq(stories.id, storyId))
    expect(story.description).toBe('A tale of woe')
    expect(story.definition?.mode).toBe(s.definition.mode)
  })

  it('saveStoryDraft re-save preserves a favorited draft', async () => {
    const { storyId } = await saveStoryDraft(emptyWorkingState(), ctx, 1)
    await ctx.runInTransaction([
      ctx.db.update(stories).set({ favorite: 1 }).where(eq(stories.id, storyId)).toSQL(),
    ])
    await saveStoryDraft(emptyWorkingState(), ctx, 2, storyId)
    const [story] = await ctx.db.select().from(stories).where(eq(stories.id, storyId))
    expect(story.favorite).toBe(1)
  })

  it('loadDraft returns null when no row exists', async () => {
    expect(await loadDraft('missing', ctx)).toBeNull()
  })

  it('loadLiveSession recovers to a fresh state and toasts when the blob fails validation', async () => {
    let sawError = false
    const unsub = toastStore.subscribe((items) => {
      sawError = items.some((item) => item.severity === 'error')
    })
    await ctx.db
      .insert(wizardSessions)
      .values({ id: 'live', storyId: 'story_orig', state: { step: 99 } as never, updatedAt: 1 })

    const loaded = await loadLiveSession(ctx)
    unsub()

    // sourceStoryId must drop with the corrupt blob — a fresh state finishing
    // into the original draft would silently overwrite it.
    expect(loaded).toEqual({ state: emptyWorkingState(), sourceStoryId: null })
    expect(sawError).toBe(true)
  })

  it('loadDraft recovers to a fresh state when the blob fails validation', async () => {
    await ctx.db
      .insert(wizardSessions)
      .values({ id: 'story_x', storyId: 'story_x', state: { step: 99 } as never, updatedAt: 1 })

    expect(await loadDraft('story_x', ctx)).toEqual(emptyWorkingState())
  })
})
