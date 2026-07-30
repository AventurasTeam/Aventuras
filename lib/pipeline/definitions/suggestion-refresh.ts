import { z } from 'zod'

import { generateStructured, type ResolveModelConfig } from '@/lib/ai'
import { inheritedEntryMetadata, type EntryMetadata } from '@/lib/db'
import { IdBiMap } from '@/lib/ids'
import { resolveSuggestionEmission, resolveSuggestionItems } from '@/lib/piggyback'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import { buildGenerationContext } from './generation-context'
import { PER_TURN_KIND } from './per-turn'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

export const SUGGESTION_REFRESH_KIND = 'suggestion-refresh'
export const SUGGESTION_EMISSION_PHASE = 'suggestion-emission'
export const SUGGESTION_TRANSLATION_PHASE = 'suggestion-translation'

export type SuggestionRefreshInput = { targetEntryId: string; refreshGuidance: string }

// No .catch([]) on the array (unlike the classifier fold, where it shields the
// sibling scene-state fields): chips are this call's only output, so a malformed
// array must fail the parse — that buys callWithRetry's re-ask and, failing
// that, the strip's error state, instead of a silent no-chip "success".
export const suggestionRefreshSchema = z.object({
  suggestions: z.array(
    z.object({
      categoryRef: z.string().describe('category ref from the prompt list, without brackets'),
      text: z.string().describe("complete prose for the reader's next turn"),
    }),
  ),
})

function readRefreshInput(inputs: unknown): SuggestionRefreshInput | null {
  if (typeof inputs !== 'object' || inputs === null) return null
  const { targetEntryId, refreshGuidance } = inputs as Partial<SuggestionRefreshInput>
  if (typeof targetEntryId !== 'string' || typeof refreshGuidance !== 'string') return null
  return { targetEntryId, refreshGuidance }
}

async function* suggestionEmissionPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const input = readRefreshInput(ctx.inputs)
  if (!input)
    return {
      status: 'failed',
      error: {
        kind: 'phase-logic',
        detail: 'suggestion-refresh: run started without a refresh input',
        phaseName: SUGGESTION_EMISSION_PHASE,
      },
    }

  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== ctx.branchId || open.storyId !== ctx.storyId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'suggestion-refresh: no open story for branch' },
    }
  if (entriesStore.getLoadedBranch() !== ctx.branchId)
    return {
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: 'suggestion-refresh: entries store loaded for another branch',
      },
    }

  const emission = resolveSuggestionEmission(open.settings)
  // Nothing to pick from is a legitimate no-op, not a failure
  // (reader-composer.md → Edge cases → Zero enabled categories). debug, not warn: the UI
  // shouldn't offer ⟳ at all here, so reaching it is defensive — but a silent
  // exit would be the one completed-with-no-delta path leaving no trace.
  if (!emission.settingsAllowEmission) {
    ctx.log.debug('classifier.suggestions_refresh_emission_disabled', {
      suggestionsEnabled: open.settings.suggestionsEnabled,
      enabledCategories: emission.slots.length,
    })
    return { status: 'completed' }
  }

  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === ctx.branchId)
    .sort((a, b) => a.position - b.position)
  const target = entries.find((e) => e.id === input.targetEntryId)
  if (!target) {
    ctx.log.warn('classifier.suggestions_refresh_target_missing', {
      targetEntryId: input.targetEntryId,
    })
    return { status: 'completed' }
  }
  // Unconditional, mirroring the system exclusion in buildGenerationContext: a
  // system entry is a transient failure card that clearSystemEntry deletes on
  // Retry / Dismiss / next Send, so chips anchored to one are born dead. The
  // reader anchors past them; this is the backstop for any other caller.
  if (target.kind === 'system') {
    ctx.log.warn('classifier.suggestions_refresh_target_transient', { targetEntryId: target.id })
    return { status: 'completed' }
  }
  // Chips seed the turn that follows THIS entry, so context past it would
  // describe another. The target is the tail in every path the UI offers, but a
  // redo landing between the click and this read would put entries after it.
  const window = entries.slice(0, entries.indexOf(target) + 1)

  const guidance = input.refreshGuidance.trim()
  const cfg = appSettingsStore.getAppSettings()
  const config: ResolveModelConfig = {
    providers: cfg.providers,
    profiles: cfg.profiles,
    assignments: cfg.assignments,
    defaultProviderId: cfg.defaultProviderId,
    storyModels: open.settings.models,
  }
  const context = buildGenerationContext({
    entries: window,
    entities: [...entitiesStore.getEntities().values()].filter((e) => e.branchId === ctx.branchId),
    definition: open.definition,
    settings: open.settings,
    idMap: new IdBiMap(),
    suggestionsFire: true,
    refreshGuidance: guidance,
  })
  const prompt = renderTemplate(TEMPLATE_IDS.suggestionRefresh, context)

  const result = await generateStructured(
    'suggestion',
    prompt,
    suggestionRefreshSchema,
    config,
    ctx.abortSignal,
  )
  if (result.status === 'aborted') return { status: 'aborted' }
  // Pre-flight halts before this phase on a broken resolver, so a failure here
  // only covers a resolver-time race the pre-flight snapshot missed.
  if (result.status === 'not-configured')
    return {
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: result.kind,
        target: 'suggestion',
        phaseName: SUGGESTION_EMISSION_PHASE,
      },
    }
  if (result.status === 'failed')
    return {
      status: 'failed',
      // generateStructured collapses provider-tier and parse-tier exhaustion into
      // one detail string; 'unknown' is the honest reason for either.
      error: { kind: 'provider', reason: 'unknown', detail: result.detail },
    }

  // A cancel that lands between the call returning and the write must discard the
  // result, not commit it (generation-pipeline.md → Abort: poll at every
  // suspension point, return aborted).
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  const { items, droppedCount } = resolveSuggestionItems(result.value.suggestions, emission)
  if (items.length === 0 || droppedCount > 0)
    ctx.log.warn('classifier.suggestions_refresh_unusable', {
      received: result.value.suggestions.length,
      dropped: droppedCount,
    })
  // Writing an empty list would blank a strip that still holds usable chips.
  if (items.length === 0) return { status: 'completed' }

  // no-gate lets CTRL-Z / rollback run during the call (they only reject against
  // a hard-gate run), so re-read rather than write from the pre-call snapshot: a
  // reversed row must not be resurrected, and a deleted one would reject at the
  // action layer and fail the run over a reversal the user asked for.
  const current = entriesStore.getById(target.id)
  if (!current) {
    ctx.log.warn('classifier.suggestions_refresh_target_reversed', { targetEntryId: target.id })
    return { status: 'completed' }
  }
  // The empty-state ⟳ Generate fires on entries that carry no metadata at all
  // (legacy rows predating the column); the scene floor keeps it schema-valid.
  const base: EntryMetadata = current.metadata ?? inheritedEntryMetadata(null)

  yield {
    type: 'delta_emitted',
    // Survival anchor (data-model.md): a reversal that spares this entry spares
    // its chips, even though the delta commits at a later log position.
    entryId: target.id,
    action: {
      kind: 'updateStoryEntryMetadata',
      source: 'ai_classifier',
      payload: {
        branchId: ctx.branchId,
        id: target.id,
        metadata: {
          ...base,
          nextTurnSuggestions: {
            items,
            source: 'refresh' as const,
            ...(guidance ? { refreshGuidance: guidance } : {}),
          },
        },
      },
    },
  }
  return { status: 'completed' }
}

// Declared no-op in M3, mirroring per-turn's user-action translation slot: no
// translation settings UI ships before M7.2, so chip text stays source-language
// until the M8.1 real call drops in here.
async function* suggestionTranslationPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const open = currentStoryStore.getCurrentStory()
  const target = open?.settings.translation.targetLanguage ?? null
  if (target !== null && target !== 'en')
    ctx.log.debug('translation.short_circuit_bypassed', {
      target,
    })
  return { status: 'completed' }
}

export function ensureSuggestionRefreshPipelineRegistered(): void {
  try {
    getPipeline(SUGGESTION_REFRESH_KIND)
  } catch {
    definePipeline({
      kind: SUGGESTION_REFRESH_KIND,
      phases: [
        {
          name: SUGGESTION_EMISSION_PHASE,
          run: suggestionEmissionPhase,
          resolves: [{ target: 'suggestion' }],
        },
        { name: SUGGESTION_TRANSLATION_PHASE, run: suggestionTranslationPhase },
      ],
      affordance: 'pill-only',
      gateBehavior: 'no-gate',
      // Yields rather than blocking per-turn: chips land on the entry that was
      // terminal when ⟳ fired, so a turn landing mid-run makes this run's own
      // output unreachable — the strip reads the new tail, and the turn emits
      // its own chips anyway. Blocking the turn instead would put friction on
      // the primary action to protect provably-dead work.
      concurrencyPolicy: {
        blockedBy: [PER_TURN_KIND, SUGGESTION_REFRESH_KIND],
        yieldsTo: [PER_TURN_KIND],
      },
    })
  }
}
