import {
  clearLiveSession,
  createStoryWithBranch,
  openStory,
  type DbCtx,
  type WizardCastEntityInput,
} from '@/lib/actions'
import { resolveModelCapabilities, type ProviderInstanceWithStub } from '@/lib/ai'
import {
  buildStorySettings,
  type CharacterState,
  type EntryMetadata,
  type FactionState,
  type ItemState,
  type LocationState,
  type ProviderInstance,
  type StoryDefinition,
  entityStateSchemaForKind,
  type StorySettings,
  type SuggestionCategory,
  type WizardCastDraft,
  type WizardCharacterDraft,
  type WizardFactionDraft,
  type WizardItemDraft,
  type WizardLocationDraft,
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

import { clampEffectiveDim } from './memory-cost-logic'
import { activeLead, invalidCastRowIds } from './step-cast-logic'
import { needsLead } from './step-frame-logic'
import { invalidLoreRowIds, type LabeledPrompt } from './step-world-logic'

export type EmbedderGateBlockedReason = Extract<EmbedderGateResult, { usable: false }>['reason']

export type FinishResult =
  | { status: 'ok'; storyId: string }
  | { status: 'invalid'; reasons: string[] }
  | { status: 'embed-blocked'; reason: EmbedderGateBlockedReason; backend: 'local' | 'provider' }
  | { status: 'embed-failed'; kind: 'init' | 'call'; message: string }
  /** Committed, but the reader never opened — the caller must not offer a retry that re-commits. */
  | { status: 'created-not-opened'; storyId: string }

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

// An intra-cast pointer only commits when it still resolves to some OTHER row of
// the expected kind: the store prunes factionId / parentLocationId as their
// target is removed, and this is the backstop for a working state that reached
// Finish some other way. Self-exclusion is part of that backstop rather than a
// guard against a reachable producer: both authoring paths already reject a
// self-reference (the editor's picker excludes self, cast-import.ts excludes
// selfId before resolving refs).
// Hand-typed definition text reaches the same columns the AI-import path
// writes, and that path trims at its Zod parse boundary
// (lib/wizard/assist-schemas.ts). Normalize here so the two agree.
function trimLabeledPrompt(v: LabeledPrompt): LabeledPrompt {
  return { label: v.label.trim(), promptBody: v.promptBody.trim() }
}

function castRef(
  cast: readonly WizardCastDraft[],
  self: WizardCastDraft,
  id: string | null,
  kind: WizardCastDraft['kind'],
): string | null {
  return id != null && id !== self.id && cast.some((r) => r.id === id && r.kind === kind)
    ? id
    : null
}

function characterVisual(draft: WizardCharacterDraft): CharacterState['visual'] {
  const visual: CharacterState['visual'] = {}
  for (const key of Object.keys(draft.visual) as (keyof WizardCharacterDraft['visual'])[]) {
    if (draft.visual[key].trim().length > 0) visual[key] = draft.visual[key]
  }
  return visual
}

// data-model.md → Authorship contract: wizard-authored identity seeds the state
// at its first write; every classifier-owned slot commits empty so the first
// classifier pass writes into a clean field rather than over an invented value.
// One builder per kind rather than one switch returning the wide EntityState —
// that union is undiscriminated, so a single function could return a location's
// shape from the item branch and still compile.
function characterState(
  draft: WizardCharacterDraft,
  cast: readonly WizardCastDraft[],
): CharacterState {
  return {
    visual: characterVisual(draft),
    traits: [...draft.traits],
    drives: [...draft.drives],
    ...(draft.voice.trim().length > 0 ? { voice: draft.voice } : {}),
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: castRef(cast, draft, draft.factionId, 'faction'),
    lastSeenAt: null,
  }
}

function locationState(
  draft: WizardLocationDraft,
  cast: readonly WizardCastDraft[],
): LocationState {
  return {
    parent_location_id: castRef(cast, draft, draft.parentLocationId, 'location'),
    ...(draft.condition.trim().length > 0 ? { condition: draft.condition } : {}),
  }
}

function itemState(draft: WizardItemDraft): ItemState {
  return {
    at_location_id: null,
    ...(draft.condition.trim().length > 0 ? { condition: draft.condition } : {}),
  }
}

function factionState(draft: WizardFactionDraft): FactionState {
  return {
    ...(draft.standing.trim().length > 0 ? { standing: draft.standing } : {}),
    ...(draft.agenda.length > 0 ? { agenda: [...draft.agenda] } : {}),
  }
}

function castEntityInput(
  draft: WizardCastDraft,
  cast: readonly WizardCastDraft[],
): WizardCastEntityInput {
  const shared = {
    id: draft.id,
    name: draft.name,
    description: draft.description.trim().length > 0 ? draft.description : null,
    status: draft.status,
    tags: [...draft.tags],
  }
  switch (draft.kind) {
    case 'character':
      return { ...shared, kind: 'character', state: characterState(draft, cast) }
    case 'location':
      return { ...shared, kind: 'location', state: locationState(draft, cast) }
    case 'item':
      return { ...shared, kind: 'item', state: itemState(draft) }
    case 'faction':
      return { ...shared, kind: 'faction', state: factionState(draft) }
  }
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
  const lead = activeLead(s.cast, s.leadEntityId)
  if (requiresLead && lead == null) reasons.push('lead')
  // In-session nav re-validates every gating step, so neither of these can be
  // reached by clicking through. hydrate() sets furthestStep = state.step with no
  // re-validation, so a persisted draft resumed straight at step 5 (the zod
  // schema defaults every name/title/body to '') skips steps 3 and 4's gates
  // entirely — re-check both here.
  if (invalidCastRowIds(s.cast).length > 0) reasons.push('cast')
  if (invalidLoreRowIds(s.lore).length > 0) reasons.push('lore')

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
  const castRows: WizardCastEntityInput[] = s.cast.map((draft) => castEntityInput(draft, s.cast))

  // createStoryWithBranch raw-inserts `state` without running the per-kind
  // schema, so an out-of-bounds row commits here and is only rejected later, by
  // the first full-state updateEntity. The editors cap every string field, so
  // this is a backstop for a resumed draft written before those caps (or a
  // hand-edited DB) — block Finish rather than silently truncating authored
  // content.
  if (
    !reasons.includes('cast') &&
    castRows.some((row) => !entityStateSchemaForKind(row.kind).safeParse(row.state).success)
  ) {
    reasons.push('cast')
  }

  if (reasons.length > 0) return { status: 'invalid', reasons }

  const definition: StoryDefinition = {
    mode: s.definition.mode,
    leadEntityId: lead?.id ?? null,
    narration: s.definition.narration,
    genre: trimLabeledPrompt(s.definition.genre),
    tone: trimLabeledPrompt(s.definition.tone),
    setting: s.definition.setting.trim(),
    calendarSystemId: s.definition.calendarSystemId,
    worldTimeOrigin: s.definition.worldTimeOrigin,
  }

  const settings = buildStorySettings(definition.mode, appDefaults, effectiveDim)

  // Opening refs commit only when they resolve to a row this transaction
  // materializes, that row is active, and its kind belongs in that field: a
  // staged entity can't appear in scene metadata (wizard.md → Status field), and
  // scene presence is kind-aware (data-model.md) — sceneEntities carries the
  // characters and items that come and go, currentLocationId is the singleton
  // "we are here" pointer, and a faction is never scene-tagged. Committing one
  // anyway is not cosmetic: entities in sceneEntities are ALWAYS injected
  // regardless of injection_mode, and the classifier promotes staged rows that
  // appear there. openingOutputSchema is a bare string array, so this is the
  // only gate between a model naming a faction and that becoming true.
  const sceneTaggableIds = new Set(
    s.cast
      .filter((r) => r.status === 'active' && (r.kind === 'character' || r.kind === 'item'))
      .map((r) => r.id),
  )
  const activeLocationIds = new Set(
    s.cast.filter((r) => r.status === 'active' && r.kind === 'location').map((r) => r.id),
  )
  const openingMetadata: EntryMetadata = {
    sceneEntities: s.opening.sceneEntities.filter((id) => sceneTaggableIds.has(id)),
    currentLocationId:
      s.opening.currentLocationId != null && activeLocationIds.has(s.opening.currentLocationId)
        ? s.opening.currentLocationId
        : null,
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
        title: s.definition.title.trim(),
        description: s.definition.description.trim() || undefined,
        definition,
        settings,
        openingContent: s.opening.content,
        openingMetadata,
        cast: castRows,
        lore: s.lore,
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
  // Past the commit, so neither a non-ok status nor a throw may surface as a
  // creation failure: openStory's read-back paths throw on DB/IPC error, and a
  // "couldn't create the story" toast would invite a retry that mints a second.
  const openFailure = await openStory(storyId, ctx, navigate, nowMs).then(
    (result) => (result.status === 'ok' ? null : result.status),
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  )
  if (openFailure != null) {
    logger.error('action_layer.wizard_open_after_create_failed', {
      storyId,
      error: openFailure,
    })
    return { status: 'created-not-opened', storyId }
  }
  return { status: 'ok', storyId }
}
