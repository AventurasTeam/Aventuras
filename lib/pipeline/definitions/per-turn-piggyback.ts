import { z } from 'zod'

import { generateStructured, resolveModel, resolveModelCapabilities } from '@/lib/ai'
import type { GenerateStructuredResult, ModelCapabilities, ResolveModelConfig } from '@/lib/ai'
import { inheritedEntryMetadata } from '@/lib/db'
import type { IdBiMap } from '@/lib/ids'
import {
  buildPiggybackActions,
  resolveSuggestionEmission,
  resolveSuggestionItems,
  substitutePiggybackIds,
  VISUAL_CHANGE_TYPES,
} from '@/lib/piggyback'
import type {
  PhaseContext,
  PhaseEmittedEvent,
  PhaseResult,
  PreflightSnapshot,
  ResolverInput,
} from '@/lib/pipeline/types'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import { buildGenerationContext } from './generation-context'

export const PIGGYBACK_FALLBACK_PHASE_NAME = 'piggyback-fallback-classifier'

export function resolvePiggybackFires(opts: {
  piggybackMode: 'on' | 'off'
  narrativeModelCapabilities?: ModelCapabilities
}): boolean {
  if (opts.piggybackMode !== 'on') return false
  return opts.narrativeModelCapabilities?.taggedBlockReliable === true
}

export type PiggybackOutcome = { attempted: boolean; succeeded: boolean }

export function shouldFallbackFire(outcome?: PiggybackOutcome): boolean {
  if (!outcome) return true
  return !outcome.attempted || !outcome.succeeded
}

export const fallbackClassifierSchema = z.object({
  sceneEntities: z.array(z.string()),
  currentLocation: z.string().optional(),
  worldTimeDelta: z.number(),
  visualChanges: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(VISUAL_CHANGE_TYPES),
        text: z.string(),
      }),
    )
    .default([]),
  transfers: z
    .object({
      items: z
        .array(
          z.object({
            id: z.string(),
            slot: z.enum(['equipped_items', 'inventory']),
            to: z.string().optional(),
            from: z.string().optional(),
          }),
        )
        .default([]),
      stackables: z
        .array(
          z.object({
            key: z.string(),
            amount: z.number(),
            to: z.string().optional(),
            from: z.string().optional(),
          }),
        )
        .default([]),
    })
    .default({ items: [], stackables: [] }),
  summary: z.string().optional(),
})

// Structured output validates the whole object in one shot, so without
// .catch([]) a malformed suggestions array would fail the entire classifier
// parse and take the (unrelated) scene-state fields down with it.
const suggestionFieldSchema = z
  .array(
    z.object({
      categoryRef: z.string().describe('opaque category id from the prompt list, e.g. cat1'),
      text: z.string().describe("complete prose for the reader's next turn"),
    }),
  )
  .catch([])

export const fallbackClassifierWithSuggestionsSchema = fallbackClassifierSchema.extend({
  suggestions: suggestionFieldSchema,
})

function hasSuggestions(
  value:
    | z.infer<typeof fallbackClassifierSchema>
    | z.infer<typeof fallbackClassifierWithSuggestionsSchema>,
): value is z.infer<typeof fallbackClassifierWithSuggestionsSchema> {
  return 'suggestions' in value
}

// architecture.md → Classifier contract — metadata fields: reject a negative
// worldTimeDelta, re-roll the classification once, then let
// resolvePiggybackWorldTimeDelta clamp-and-warn if it's still negative. A
// re-roll here means redoing the whole structured call (this is an isolated
// classifier call, unlike the narrative path where the delta rides the same
// call as the prose and can't be re-rolled alone).
async function generateClassifierState<T extends { worldTimeDelta: number }>(
  prompt: string,
  schema: z.ZodType<T>,
  config: ResolveModelConfig,
  abortSignal: AbortSignal,
): Promise<GenerateStructuredResult<T>> {
  const first = await generateStructured('classifier', prompt, schema, config, abortSignal)
  if (first.status !== 'ok' || first.value.worldTimeDelta >= 0) return first
  const reroll = await generateStructured('classifier', prompt, schema, config, abortSignal)
  return reroll.status === 'ok' ? reroll : first
}

export async function* piggybackFallbackClassifierPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const open = currentStoryStore.getCurrentStory()
  if (!open)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'piggyback-fallback: no open story' },
    }

  const outcome = ctx.intermediates.piggybackOutcome as PiggybackOutcome | undefined
  if (!shouldFallbackFire(outcome)) return { status: 'completed' }

  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === ctx.branchId)
    .sort((a, b) => a.position - b.position)
  const tail = entries.at(-1)
  if (!tail) return { status: 'completed' }
  const previousEntry = entries.at(-2)

  const entities = [...entitiesStore.getEntities().values()].filter(
    (e) => e.branchId === ctx.branchId,
  )

  const suggestionEmission = resolveSuggestionEmission(open.settings)
  // Only ask when chips aren't already in hand: a <state>-failed /
  // <suggestions>-ok turn fires this phase for state alone, and re-rolling
  // would overwrite good chips with a second opinion.
  const suggestionsAlreadyCaptured = ctx.intermediates.suggestionsCaptured === true
  const askForSuggestions = suggestionEmission.settingsAllowEmission && !suggestionsAlreadyCaptured

  // Same context builder + template pattern as the narrative phase
  // (lib/pipeline/definitions/per-turn.ts) — the classifier is a
  // story-related prompt like any other, not a special case. Reuses the
  // narrative phase's idMap (ctx.intermediates) so placeholder IDs stay
  // consistent across the turn instead of being renumbered from scratch.
  const idMap = ctx.intermediates.idMap as IdBiMap
  const context = buildGenerationContext({
    branchId: ctx.branchId,
    // The user's action can itself carry state changes ("I put the sword
    // away"), not just the AI's reply — both entries go to the classifier.
    entries: previousEntry ? [previousEntry, tail] : [tail],
    entities,
    definition: open.definition,
    settings: open.settings,
    idMap,
    suggestionsFire: askForSuggestions,
  })
  const prompt = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context)

  const appSettings = appSettingsStore.getAppSettings()
  const classifierConfig: ResolveModelConfig = {
    providers: appSettings.providers,
    profiles: appSettings.profiles,
    assignments: appSettings.assignments,
    defaultProviderId: appSettings.defaultProviderId,
    storyModels: open.settings.models,
  }
  const result = askForSuggestions
    ? await generateClassifierState(
        prompt,
        fallbackClassifierWithSuggestionsSchema,
        classifierConfig,
        ctx.abortSignal,
      )
    : await generateClassifierState(
        prompt,
        fallbackClassifierSchema,
        classifierConfig,
        ctx.abortSignal,
      )
  if (result.status !== 'ok') {
    ctx.log.warn('classifier.piggyback_fallback_failed', {
      status: result.status,
      ...('kind' in result ? { errorKind: result.kind } : {}),
      ...('detail' in result ? { errorDetail: result.detail } : {}),
    })
    return { status: 'completed' }
  }

  const { block: resolvedBlock, failures } = substitutePiggybackIds(result.value, idMap)
  if (failures.length > 0) {
    ctx.log.warn('classifier.piggyback_fallback_parse_failed', {
      fields: failures.map((f) => f.field),
      failures: failures.map((f) => ({ field: f.field, errorDetail: f.detail })),
    })
  }

  const { metadata: scenePatch, actions } = buildPiggybackActions({
    entryId: tail.id,
    block: resolvedBlock,
    entities,
    previousMetadata: {
      ...inheritedEntryMetadata(previousEntry?.metadata),
      ...(previousEntry?.id ? { entryId: previousEntry.id } : {}),
    },
    branchId: ctx.branchId,
    source: 'per_turn_classifier',
  })

  const rawSuggestions =
    askForSuggestions && hasSuggestions(result.value) ? result.value.suggestions : []
  const { items: suggestionItems, droppedCount } = resolveSuggestionItems(
    rawSuggestions,
    suggestionEmission,
  )
  // A malformed suggestions array is already indistinguishable from a
  // genuinely-empty one by the time we get here — .catch([]) collapses both
  // to [] at parse time, and unlike the narrative fold there's no sibling
  // blockFound/failed signal on this isolated structured call to tell them
  // apart. Warn on either zero-captured or any drop so a model that
  // consistently emits malformed chips doesn't fail silently forever
  // (callWithRetry's parse-retry never sees this: .catch() means the parse
  // itself never fails).
  if (
    askForSuggestions &&
    (suggestionItems.length === 0 ||
      droppedCount > 0 ||
      suggestionItems.length < suggestionEmission.count)
  ) {
    ctx.log.warn('classifier.suggestions_parse_failed', {
      received: rawSuggestions.length,
      dropped: droppedCount,
      resolved: suggestionItems.length,
      expected: suggestionEmission.count,
    })
  }

  yield {
    type: 'delta_emitted',
    action: {
      kind: 'updateStoryEntryMetadata',
      source: 'per_turn_classifier',
      payload: {
        branchId: ctx.branchId,
        id: tail.id,
        metadata: {
          ...tail.metadata,
          ...scenePatch,
          ...(suggestionItems.length > 0
            ? { nextTurnSuggestions: { items: suggestionItems, source: 'classifier' as const } }
            : {}),
        },
      },
    },
  }
  for (const action of actions) {
    yield { type: 'delta_emitted', action }
  }
  return { status: 'completed' }
}

function resolveNarrativeCapabilities(snapshot: PreflightSnapshot): ModelCapabilities | undefined {
  const resolved = resolveModel('narrative', {
    providers: snapshot.appSettings.providers,
    profiles: snapshot.appSettings.profiles,
    assignments: snapshot.appSettings.assignments,
    defaultProviderId: snapshot.appSettings.defaultProviderId,
    storyModels: snapshot.storySettings?.models,
  })
  if (!resolved.ok) return undefined
  return resolveModelCapabilities(
    resolved.providerId,
    resolved.modelId,
    snapshot.appSettings.providers,
  )
}

export const PIGGYBACK_FALLBACK_RESOLVES: readonly ResolverInput[] = [
  {
    target: 'classifier',
    when: (snapshot) =>
      !resolvePiggybackFires({
        piggybackMode: snapshot.storySettings?.piggybackMode ?? 'off',
        narrativeModelCapabilities: resolveNarrativeCapabilities(snapshot),
      }),
  },
]
