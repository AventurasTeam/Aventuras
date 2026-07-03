import { eq } from 'drizzle-orm'

import { stories, wizardSessions, type WizardWorkingState } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { rehydrateStories } from '@/lib/stores'

import type { DbCtx } from '../types'

const LIVE_SESSION_ID = 'live'

export async function saveLiveSession(
  state: WizardWorkingState,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<void> {
  await ctx.runInTransaction([
    ctx.db.delete(wizardSessions).where(eq(wizardSessions.id, LIVE_SESSION_ID)).toSQL(),
    ctx.db
      .insert(wizardSessions)
      .values({ id: LIVE_SESSION_ID, storyId: null, state, updatedAt: nowMs })
      .toSQL(),
  ])
}

export async function clearLiveSession(ctx: DbCtx): Promise<void> {
  await ctx.runInTransaction([
    ctx.db.delete(wizardSessions).where(eq(wizardSessions.id, LIVE_SESSION_ID)).toSQL(),
  ])
}

export async function sessionExists(ctx: DbCtx): Promise<boolean> {
  const rows = await ctx.db
    .select({ id: wizardSessions.id })
    .from(wizardSessions)
    .where(eq(wizardSessions.id, LIVE_SESSION_ID))
  return rows.length > 0
}

export async function saveStoryDraft(
  state: WizardWorkingState,
  ctx: DbCtx,
  nowMs: number = Date.now(),
  existingStoryId?: string,
): Promise<{ storyId: string }> {
  const storyId = existingStoryId ?? generateId('story')
  const title = state.definition.title || 'Untitled story'

  const [existing] = existingStoryId
    ? await ctx.db
        .select({ createdAt: stories.createdAt })
        .from(stories)
        .where(eq(stories.id, existingStoryId))
    : []
  const createdAt = existing?.createdAt ?? nowMs

  await ctx.runInTransaction([
    ctx.db.delete(stories).where(eq(stories.id, storyId)).toSQL(),
    ctx.db
      .insert(stories)
      .values({ id: storyId, title, status: 'draft', createdAt, updatedAt: nowMs })
      .toSQL(),
    ctx.db.delete(wizardSessions).where(eq(wizardSessions.id, storyId)).toSQL(),
    ctx.db.insert(wizardSessions).values({ id: storyId, storyId, state, updatedAt: nowMs }).toSQL(),
    ctx.db.delete(wizardSessions).where(eq(wizardSessions.id, LIVE_SESSION_ID)).toSQL(),
  ])

  await rehydrateStories(ctx.db)
  return { storyId }
}

export async function loadDraft(storyId: string, ctx: DbCtx): Promise<WizardWorkingState | null> {
  const [row] = await ctx.db.select().from(wizardSessions).where(eq(wizardSessions.id, storyId))
  return row?.state ?? null
}

// The live singleton's state must be re-hydrated into wizardStore on Continue —
// the in-memory store resets on every app boot, so without this a restart's
// worth of auto-saved progress would open as a blank wizard despite the row
// surviving in SQLite.
export async function loadLiveSession(ctx: DbCtx): Promise<WizardWorkingState | null> {
  const [row] = await ctx.db
    .select()
    .from(wizardSessions)
    .where(eq(wizardSessions.id, LIVE_SESSION_ID))
  return row?.state ?? null
}
