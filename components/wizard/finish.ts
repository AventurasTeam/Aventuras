import { clearLiveSession, createStoryWithBranch, openStory, type DbCtx } from '@/lib/actions'
import type { ProviderInstanceWithStub } from '@/lib/ai'
import {
  buildStorySettings,
  type EntryMetadata,
  type StoryDefinition,
  type StorySettings,
  type WizardWorkingState,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  EmbedderCallError,
  EmbedderInitError,
  resolveEmbedderGate,
  type EmbedderGateResult,
} from '@/lib/embedder'
import { generateId } from '@/lib/ids'

import { needsLead } from './step-frame-logic'

export type EmbedderGateBlockedReason = Extract<EmbedderGateResult, { usable: false }>['reason']

export type FinishResult =
  | { status: 'ok'; storyId: string }
  | { status: 'invalid'; reasons: string[] }
  | { status: 'embed-blocked'; reason: EmbedderGateBlockedReason }
  | { status: 'embed-failed'; kind: 'init' | 'call'; message: string }

export type FinishAppDefaults = {
  defaultStorySettings: Partial<StorySettings>
  embeddingModelId: string | null
  embeddingProviderId: string | null
  providers: readonly { id: string }[]
  installedLocalIds: readonly string[]
}

// The exec + provider seams the embed step needs, threaded from the store-aware
// caller so finish.ts stays store-free: exec runs raw vec DDL, resolveProvider
// looks up the configured provider instance for provider-backend configs.
export type FinishEmbedCtx = {
  exec: (sql: string) => Promise<void>
  resolveProvider: (providerId: string) => ProviderInstanceWithStub | undefined
}

export async function finishWizard(
  s: WizardWorkingState,
  ctx: DbCtx,
  navigate: (branchId: string) => void,
  appDefaults: FinishAppDefaults,
  embedCtx: FinishEmbedCtx,
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

  // Hard gate re-check at commit time (also enforced at wizard entry): an
  // embedder removed mid-session must block the commit, not silently create a
  // story with no retrieval. Applies regardless of lead presence — creation
  // requires a configured embedder even when this story has nothing to embed yet.
  const gate = resolveEmbedderGate(
    {
      embeddingModelId: appDefaults.embeddingModelId,
      embeddingProviderId: appDefaults.embeddingProviderId,
      defaultStorySettings: appDefaults.defaultStorySettings,
      providers: appDefaults.providers,
    },
    appDefaults.installedLocalIds,
  )
  if (!gate.usable) return { status: 'embed-blocked', reason: gate.reason }

  let commit: { storyId: string; branchId: string }
  try {
    commit = await createStoryWithBranch(
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
        embed: {
          config: gate.config,
          exec: embedCtx.exec,
          provider:
            gate.config.backend === 'provider'
              ? embedCtx.resolveProvider(gate.config.providerId)
              : undefined,
        },
      },
      ctx,
      nowMs,
    )
  } catch (err) {
    // Embed failures (init/call, incl. vec-ensure) surface as the graceful
    // step-5 error card; nothing committed since the throw precedes the batch.
    if (err instanceof EmbedderInitError || err instanceof EmbedderCallError) {
      return { status: 'embed-failed', kind: err.kind, message: err.message }
    }
    throw err
  }
  const { storyId } = commit

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
