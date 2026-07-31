import { clearLiveSession, createStoryWithBranch, openStory, type DbCtx } from '@/lib/actions'
import { resolveModelCapabilities, type ProviderInstanceWithStub } from '@/lib/ai'
import {
  buildStorySettings,
  type EntryMetadata,
  type ProviderInstance,
  type StoryDefinition,
  type StorySettings,
  type SuggestionCategory,
  type WizardWorkingState,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  EmbedderCallError,
  EmbedderInitError,
  resolveEmbedderConfig,
  resolveEmbedderGate,
  type EmbedderGateResult,
} from '@/lib/embedder'
import { generateId } from '@/lib/ids'

import { clampEffectiveDim } from './memory-cost-logic'
import { needsLead } from './step-frame-logic'

export type EmbedderGateBlockedReason = Extract<EmbedderGateResult, { usable: false }>['reason']

export type FinishResult =
  | { status: 'ok'; storyId: string }
  | { status: 'invalid'; reasons: string[] }
  | { status: 'embed-blocked'; reason: EmbedderGateBlockedReason; backend: 'local' | 'provider' }
  | { status: 'embed-failed'; kind: 'init' | 'call'; message: string }

export type FinishAppDefaults = {
  defaultStorySettings: Partial<StorySettings>
  embeddingModelId: string | null
  embeddingProviderId: string | null
  defaultSuggestionCategories: {
    adventure: readonly SuggestionCategory[]
    creative: readonly SuggestionCategory[]
  }
  providers: readonly ProviderInstance[]
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

  // effectiveDim only means something for a provider-backed Matryoshka model; if
  // the app default swapped to a non-Matryoshka model/backend mid-session, the
  // hidden disclosure can't clear the stale pick, so drop it to native (canon:
  // the flag governs new-story creation) rather than committing/validating it.
  const embeddingCapabilities =
    appDefaults.defaultStorySettings.embeddingBackend === 'provider' &&
    appDefaults.embeddingProviderId != null &&
    appDefaults.embeddingModelId != null
      ? resolveModelCapabilities(
          appDefaults.embeddingProviderId,
          appDefaults.embeddingModelId,
          appDefaults.providers,
        )
      : undefined
  const matryoshkaApplicable = embeddingCapabilities?.matryoshkaSupported === true
  // Clamped, not rejected: the disclosure is hidden on a non-applicable model and
  // collapsed by default, so a working state carrying a dim above the CURRENT
  // model's native ceiling would fail an invisible field. Degrading to native
  // matches what the embed service produces either way.
  const effectiveDim = clampEffectiveDim(
    matryoshkaApplicable ? s.effectiveDim : null,
    embeddingCapabilities?.embeddingDim,
  )
  // Backstop: the disclosure keeps only valid dims (or null), but a corrupt
  // working state must never commit a dim that truncates vectors to garbage.
  if (effectiveDim != null && (!Number.isInteger(effectiveDim) || effectiveDim < 1))
    reasons.push('effectiveDim')
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

  const settings = buildStorySettings(definition.mode, appDefaults, effectiveDim)

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
  if (!gate.usable) return { status: 'embed-blocked', reason: gate.reason, backend: gate.backend }

  // Resolved against the settings about to be committed, not the gate's config:
  // the gate resolves with no story, so it carries no Matryoshka truncation and
  // would land this vector in the native-dim family nothing else ever queries.
  const embedResolution = resolveEmbedderConfig(
    settings,
    {
      embeddingModelId: appDefaults.embeddingModelId,
      embeddingProviderId: appDefaults.embeddingProviderId,
      defaultStorySettings: appDefaults.defaultStorySettings,
    },
    {
      providerDim: embeddingCapabilities?.embeddingDim,
      matryoshkaSupported: matryoshkaApplicable,
    },
  )
  if (!embedResolution.ok) {
    const reason =
      embedResolution.reason === 'unknown-local-model' ? 'unknown-model' : embedResolution.reason
    return { status: 'embed-blocked', reason, backend: settings.embeddingBackend }
  }
  const embedConfig = embedResolution.config

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
          config: embedConfig,
          exec: embedCtx.exec,
          provider:
            embedConfig.backend === 'provider'
              ? embedCtx.resolveProvider(embedConfig.providerId)
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
