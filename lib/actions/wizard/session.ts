import { eq } from 'drizzle-orm'

import {
  emptyCastDraft,
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
import { CAST_ID_PREFIX, rehydrateStories } from '@/lib/stores'
import { toast } from '@/lib/toast'

import type { DbCtx } from '../types'

const LIVE_SESSION_ID = 'live'

export async function saveLiveSession(
  state: WizardWorkingState,
  ctx: DbCtx,
  nowMs: number = Date.now(),
  sourceStoryId?: string,
): Promise<void> {
  await ctx.runInTransaction([
    ctx.db.delete(wizardSessions).where(eq(wizardSessions.id, LIVE_SESSION_ID)).toSQL(),
    ctx.db
      .insert(wizardSessions)
      .values({ id: LIVE_SESSION_ID, storyId: sourceStoryId ?? null, state, updatedAt: nowMs })
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

// Pre-3.6b working states carried the lead as a bare `leadName` string.
export function migrateLegacyLead(state: WizardWorkingState): WizardWorkingState {
  if (state.cast.length > 0 || state.leadName.trim().length === 0) return state
  // Reuse, don't mint: the opening's sceneEntities already reference this id.
  const id = state.leadEntityId ?? generateId(CAST_ID_PREFIX.character)
  const lead = { ...emptyCastDraft('character', id), name: state.leadName.trim() }
  return { ...state, cast: [lead], leadEntityId: id, leadName: '' }
}

// Persisted rows predate the current schema: a field the wizard now reads may
// be missing or the wrong shape after an app upgrade, and returning the raw
// blob would surface that as a crash deep in the wizard. Re-validate on load and
// fall back to a fresh state, toasting so the reset is visible rather than a
// silently blanked draft.
function parsePersistedState(
  raw: unknown,
  source: string,
): { state: WizardWorkingState; ok: boolean } {
  const parsed = wizardWorkingStateSchema.safeParse(raw)
  if (parsed.success) return { state: migrateLegacyLead(parsed.data), ok: true }
  logger.warn('action_layer.wizard_session_parse_failed', {
    source,
    issues: parsed.error.issues.length,
  })
  toast.error(t('landing:errors.sessionStateCorrupt'))
  return { state: emptyWorkingState(), ok: false }
}

export async function loadDraft(storyId: string, ctx: DbCtx): Promise<WizardWorkingState | null> {
  const [row] = await ctx.db.select().from(wizardSessions).where(eq(wizardSessions.id, storyId))
  if (!row) return null
  return parsePersistedState(row.state, 'draft').state
}

type LiveSession = { state: WizardWorkingState; sourceStoryId: string | null }

// The live singleton's state must be re-hydrated into wizardStore on Continue —
// the in-memory store resets on every app boot, so without this a restart's
// worth of auto-saved progress would open as a blank wizard despite the row
// surviving in SQLite. sourceStoryId rides along so a session that began as a
// resumed draft finishes as that draft's promotion, not a duplicate story.
export async function loadLiveSession(ctx: DbCtx): Promise<LiveSession | null> {
  const [row] = await ctx.db
    .select()
    .from(wizardSessions)
    .where(eq(wizardSessions.id, LIVE_SESSION_ID))
  if (!row) return null
  const { state, ok } = parsePersistedState(row.state, 'live')
  // A corrupt blob resets to a fresh state; keeping the draft pointer would
  // let Finish overwrite the original draft with that fresh state.
  return { state, sourceStoryId: ok ? row.storyId : null }
}
