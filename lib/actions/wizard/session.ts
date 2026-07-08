import { eq } from 'drizzle-orm'

import {
  emptyWorkingState,
  stories,
  wizardSessions,
  wizardWorkingStateSchema,
  type StoryDefinition,
  type WizardWorkingState,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { generateId } from '@/lib/ids'
import { rehydrateStories } from '@/lib/stores'
import { toast } from '@/lib/toast'

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

// Persisted rows predate the current schema: a field the wizard now reads may
// be missing or the wrong shape after an app upgrade, and returning the raw
// blob would surface that as a crash deep in the wizard. Re-validate on load and
// fall back to a fresh state, toasting so the reset is visible rather than a
// silently blanked draft.
function parsePersistedState(raw: unknown, source: string): WizardWorkingState {
  const parsed = wizardWorkingStateSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  logger.warn('action_layer.wizard_session_parse_failed', {
    source,
    issues: parsed.error.issues.length,
  })
  toast.error(t('landing:errors.sessionStateCorrupt'))
  return emptyWorkingState()
}

export async function loadDraft(storyId: string, ctx: DbCtx): Promise<WizardWorkingState | null> {
  const [row] = await ctx.db.select().from(wizardSessions).where(eq(wizardSessions.id, storyId))
  if (!row) return null
  return parsePersistedState(row.state, 'draft')
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
  if (!row) return null
  return parsePersistedState(row.state, 'live')
}
