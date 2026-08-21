import { eq } from 'drizzle-orm'
import type { ZodType } from 'zod'

import {
  emptyWorkingState,
  stories,
  wizardCastDraftSchema,
  wizardLoreDraftSchema,
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

// `structural` (not even an array) stays apart from `dropped` (a per-item
// parse failure) so a whole missing container is never miscounted as "1 row".
function salvageRows<T>(
  raw: unknown,
  schema: ZodType<T>,
): { rows: T[]; dropped: number; structural: boolean } {
  if (raw == null) return { rows: [], dropped: 0, structural: false }
  if (!Array.isArray(raw)) return { rows: [], dropped: 0, structural: true }
  const rows: T[] = []
  let dropped = 0
  for (const item of raw) {
    const parsed = schema.safeParse(item)
    if (parsed.success) rows.push(parsed.data)
    else dropped++
  }
  return { rows, dropped, structural: false }
}

// Scalar shell resets wholesale; row arrays salvage element-wise, like decodeCaptures.
function parsePersistedState(
  raw: unknown,
  source: string,
): { state: WizardWorkingState; ok: boolean; dropped: number } {
  const shell = wizardWorkingStateSchema.omit({ lore: true, cast: true }).safeParse(raw)
  if (!shell.success) {
    logger.warn('action_layer.wizard_session_parse_failed', {
      source,
      issues: shell.error.issues.length,
    })
    toast.error(t('landing:errors.sessionStateCorrupt'))
    return { state: emptyWorkingState(), ok: false, dropped: 0 }
  }
  const blob = raw as Record<string, unknown>
  const lore = salvageRows(blob.lore, wizardLoreDraftSchema)
  const cast = salvageRows(blob.cast, wizardCastDraftSchema)
  const dropped = lore.dropped + cast.dropped
  const structural = lore.structural || cast.structural
  if (dropped > 0 || structural) {
    logger.warn('action_layer.wizard_session_rows_dropped', {
      source,
      lore: lore.dropped,
      cast: cast.dropped,
      structural,
    })
  }
  if (dropped > 0) toast.error(t('landing:errors.sessionRowsDropped', { count: dropped }))
  if (structural) toast.error(t('landing:errors.sessionSectionUnreadable'))
  return { state: { ...shell.data, lore: lore.rows, cast: cast.rows }, ok: !structural, dropped }
}

type DraftSession = {
  state: WizardWorkingState
  sourceDraftId: string | null
  /** Unreadable rows left behind in the draft row this pointer still targets. */
  droppedRows: number
}

// sourceDraftId mirrors loadLiveSession's sourceStoryId: an unparseable blob resets to
// a fresh state, and keeping the pointer would let Save or Finish overwrite the draft.
export async function loadDraft(storyId: string, ctx: DbCtx): Promise<DraftSession | null> {
  const [row] = await ctx.db.select().from(wizardSessions).where(eq(wizardSessions.id, storyId))
  if (!row) return null
  const { state, ok, dropped } = parsePersistedState(row.state, 'draft')
  return { state, sourceDraftId: ok ? storyId : null, droppedRows: dropped }
}

type LiveSession = {
  state: WizardWorkingState
  sourceStoryId: string | null
  /** Unreadable rows this blob lost on load, as loadDraft reports for a draft. */
  droppedRows: number
}

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
  const { state, ok, dropped } = parsePersistedState(row.state, 'live')
  // A corrupt blob resets to a fresh state; keeping the draft pointer would
  // let Finish overwrite the original draft with that fresh state.
  return { state, sourceStoryId: ok ? row.storyId : null, droppedRows: dropped }
}
