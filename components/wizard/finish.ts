import { clearLiveSession, createStoryWithBranch, openStory, type DbCtx } from '@/lib/actions'
import {
  buildStorySettings,
  type EntryMetadata,
  type StoryDefinition,
  type StorySettings,
  type WizardWorkingState,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'

import { needsLead } from './step-frame-logic'

export type FinishResult =
  | { status: 'ok'; storyId: string }
  | { status: 'invalid'; reasons: string[] }

export type FinishAppDefaults = {
  defaultStorySettings: Partial<StorySettings>
  embeddingModelId: string | null
}

export async function finishWizard(
  s: WizardWorkingState,
  ctx: DbCtx,
  navigate: (branchId: string) => void,
  appDefaults: FinishAppDefaults,
  nowMs?: number,
  // When the working-state came from a resumed draft, its stories row (and
  // wizard_sessions row) are replaced in place instead of minting a new id —
  // undefined on a fresh Finish, so createStoryWithBranch generates one.
  promoteDraftStoryId?: string,
): Promise<FinishResult> {
  const reasons: string[] = []
  if (s.definition.title.trim().length === 0) reasons.push('title')
  if (s.opening.content.trim().length === 0) reasons.push('opening')
  const requiresLead = needsLead(s.definition.mode, s.definition.narration)
  if (requiresLead && s.leadName.trim().length === 0) reasons.push('lead')
  if (reasons.length > 0) return { status: 'invalid', reasons }

  const lead = requiresLead
    ? { id: s.leadEntityId ?? generateId('char'), name: s.leadName }
    : undefined

  const definition: StoryDefinition = {
    mode: s.definition.mode,
    leadEntityId: lead?.id ?? null,
    narration: s.definition.narration,
    genre: s.definition.genre,
    tone: s.definition.tone,
    setting: s.definition.setting,
    calendarSystemId: s.definition.calendarSystemId,
    worldTimeOrigin: s.definition.worldTimeOrigin,
  }

  const settings = buildStorySettings(
    appDefaults.defaultStorySettings,
    appDefaults.embeddingModelId,
  )

  // The lead is the only entity the M2 commit materializes, so it's the only id
  // opening refs can legitimately point at: keep the lead in sceneEntities, drop
  // everything else (a back-jump clearing the lead requirement, or a hallucinated
  // location id, would otherwise commit a dangling ref to a never-created row).
  const openingMetadata: EntryMetadata = {
    sceneEntities: lead ? s.opening.sceneEntities.filter((id) => id === lead.id) : [],
    currentLocationId: null,
    worldTime: 0,
    ...(s.opening.model ? { model: s.opening.model } : {}),
  }

  const { storyId } = await createStoryWithBranch(
    {
      storyId: promoteDraftStoryId,
      replaceExistingStoryId: promoteDraftStoryId != null,
      title: s.definition.title,
      description:
        s.definition.description.trim().length > 0 ? s.definition.description : undefined,
      definition,
      settings,
      openingContent: s.opening.content,
      openingMetadata,
      lead,
    },
    ctx,
    nowMs,
  )

  // The story is already committed; clearing the live session is cleanup. If it
  // throws, swallow it so navigation still fires — otherwise Finish stalls on
  // the wizard and a retry would mint a second story from the same working state.
  try {
    await clearLiveSession(ctx)
  } catch (err) {
    logger.warn('action_layer.wizard_live_session_cleanup_failed', {
      storyId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await openStory(storyId, ctx, navigate, nowMs)
  return { status: 'ok', storyId }
}
