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
    s.definition.title = 'Aria'
    s.step = 5
    const { storyId } = await saveStoryDraft(s, ctx, 1)
    const loaded = await loadDraft(storyId, ctx)
    expect(loaded?.state.definition.title).toBe('Aria')
    expect(loaded?.state.step).toBe(5)
    expect(loaded?.sourceDraftId).toBe(storyId)
  })

  it('clearLiveSession removes only the live singleton', async () => {
    await saveLiveSession(emptyWorkingState(), ctx, 1)
    await clearLiveSession(ctx)
    expect(await sessionExists(ctx)).toBe(false)
  })

  it('loadLiveSession round-trips the persisted live state, and is null once cleared', async () => {
    expect(await loadLiveSession(ctx)).toBeNull()
    const s = emptyWorkingState()
    s.definition.title = 'Bran'
    s.step = 2
    await saveLiveSession(s, ctx, 1)
    const loaded = await loadLiveSession(ctx)
    expect(loaded?.state.definition.title).toBe('Bran')
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
    expect(loaded?.state.definition.title).toBe('Second save')
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

  it('loadDraft recovers to a fresh state and orphans the pointer on a shell failure', async () => {
    await ctx.db
      .insert(wizardSessions)
      .values({ id: 'story_x', storyId: 'story_x', state: { step: 99 } as never, updatedAt: 1 })

    // sourceDraftId must drop with the corrupt blob: a fresh state saving back into
    // the original draft would replace the only copy of it with a blank one.
    expect(await loadDraft('story_x', ctx)).toEqual({
      state: emptyWorkingState(),
      sourceDraftId: null,
      // A shell failure resets wholesale, so no per-row count is meaningful —
      // and with no pointer there is no Save to confirm against.
      droppedRows: 0,
    })
  })

  it('loadDraft keeps the pointer when rows salvage under a healthy shell', async () => {
    const good = emptyWorkingState()
    const state = {
      ...good,
      definition: { ...good.definition, title: 'Kept title' },
      lore: [{ id: 'lore_a', title: 'Kept lore' }, { title: 'Missing id' }],
    }
    await ctx.db
      .insert(wizardSessions)
      .values({ id: 'story_y', storyId: 'story_y', state: state as never, updatedAt: 1 })

    const loaded = await loadDraft('story_y', ctx)

    expect(loaded?.state.lore.map((row) => row.id)).toEqual(['lore_a'])
    // A partial salvage is still a resumable draft, so the pointer survives.
    // Without this the orphan rule degenerates into "never resume a draft".
    expect(loaded?.sourceDraftId).toBe('story_y')
    // Reported rather than merely toasted: the pointer means Save will replace
    // the row these rows are still in, and the wizard confirms that first.
    expect(loaded?.droppedRows).toBe(1)
  })

  it('reports no dropped rows for a draft that parses whole', async () => {
    const good = emptyWorkingState()
    await ctx.db.insert(wizardSessions).values({
      id: 'story_whole',
      storyId: 'story_whole',
      state: { ...good, definition: { ...good.definition, title: 'Whole' } } as never,
      updatedAt: 1,
    })

    const loaded = await loadDraft('story_whole', ctx)

    expect(loaded?.droppedRows).toBe(0)
    expect(loaded?.sourceDraftId).toBe('story_whole')
  })

  it('loadDraft orphans the pointer when a row container is unreadable', async () => {
    const good = emptyWorkingState()
    await ctx.db.insert(wizardSessions).values({
      id: 'story_z',
      storyId: 'story_z',
      state: { ...good, definition: { ...good.definition, title: 'Kept' }, cast: 'oops' } as never,
      updatedAt: 1,
    })

    const loaded = await loadDraft('story_z', ctx)

    expect(loaded?.state.definition.title).toBe('Kept')
    expect(loaded?.state.cast).toEqual([])
    expect(loaded?.sourceDraftId).toBeNull()
  })

  it('salvages healthy rows when a cast row and a lore row are malformed', async () => {
    let sawError = false
    const unsub = toastStore.subscribe((items) => {
      sawError = items.some((item) => item.severity === 'error')
    })
    const good = emptyWorkingState()
    const state = {
      ...good,
      definition: { ...good.definition, title: 'Kept title' },
      cast: [
        { id: 'char_a', kind: 'character', name: 'Kara' },
        { id: 'char_b', kind: 'not-a-kind', name: 42 },
      ],
      lore: [{ id: 'lore_a', title: 'Kept lore' }, { title: 'Missing id' }],
    }
    await ctx.db
      .insert(wizardSessions)
      .values({ id: 'live', storyId: 'story_orig', state: state as never, updatedAt: 1 })

    const loaded = await loadLiveSession(ctx)
    unsub()

    expect(loaded?.state.definition.title).toBe('Kept title')
    expect(loaded?.state.cast.map((row) => row.id)).toEqual(['char_a'])
    expect(loaded?.state.lore.map((row) => row.id)).toEqual(['lore_a'])
    // Salvaged rows go through the schema, not a raw passthrough — an
    // un-defaulted row is exactly what later crashes the wizard (row.tags.map).
    expect(loaded?.state.cast[0]?.status).toBe('active')
    expect(loaded?.state.lore[0]?.injectionMode).toBe('auto')
    // A partial salvage keeps ok true, so the draft pointer survives — only a
    // shell failure orphans it.
    expect(loaded?.sourceStoryId).toBe('story_orig')
    expect(sawError).toBe(true)
  })

  it('clears an unreadable section, toasts, and orphans the draft pointer', async () => {
    let sawError = false
    const unsub = toastStore.subscribe((items) => {
      sawError = items.some((item) => item.severity === 'error')
    })
    const good = emptyWorkingState()
    const state = {
      ...good,
      definition: { ...good.definition, title: 'Kept title' },
      opening: { ...good.opening, content: 'Kept prose' },
      cast: 'oops',
    }
    await ctx.db
      .insert(wizardSessions)
      .values({ id: 'live', storyId: 'story_orig', state: state as never, updatedAt: 1 })

    const loaded = await loadLiveSession(ctx)
    unsub()

    // Shell fields survive a structural row-container failure — only the
    // unreadable section is cleared.
    expect(loaded?.state.definition.title).toBe('Kept title')
    expect(loaded?.state.opening.content).toBe('Kept prose')
    expect(loaded?.state.cast).toEqual([])
    // Unknown-size loss can't claim a count, but it must still orphan the
    // draft pointer so the next save can't overwrite the original with it.
    expect(loaded?.sourceStoryId).toBeNull()
    expect(sawError).toBe(true)
  })
})
