import { eq } from 'drizzle-orm'

import { stories, wizardSessions, type StoryDefinition, type WizardWorkingState } from '@/lib/db'
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
  const description =
    state.definition.description.trim().length > 0 ? state.definition.description : null
  const definition: StoryDefinition = {
    mode: state.definition.mode,
    leadEntityId: state.leadEntityId ?? null,
    narration: state.definition.narration,
    genre: state.definition.genre,
    tone: state.definition.tone,
    setting: state.definition.setting,
    calendarSystemId: state.definition.calendarSystemId,
    worldTimeOrigin: state.definition.worldTimeOrigin,
  }

  await ctx.runInTransaction([
    // Upsert, not delete+insert: a re-saved draft must keep the card-backing
    // columns the wizard doesn't own (favorite, createdAt), which selectStoryCards
    // reads for filter/sort. definition + description carry mode accent, genre
    // search, and the card description — the same fields Finish writes.
    ctx.db
      .insert(stories)
      .values({
        id: storyId,
        title,
        description,
        status: 'draft',
        definition,
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: stories.id,
        set: { title, description, status: 'draft', definition, updatedAt: nowMs },
      })
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
