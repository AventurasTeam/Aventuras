import { z } from 'zod'

import { generateStructured, resolveModel, resolveModelCapabilities } from '@/lib/ai'
import type {
  GenerateStructuredResult,
  ModelCapabilities,
  PromptHalves,
  ResolveModelConfig,
  StructuredCallOptions,
} from '@/lib/ai'
import { inheritedEntryMetadata } from '@/lib/db'
import { generateId } from '@/lib/ids'
import {
  buildPiggybackActions,
  buildStateReport,
  MAX_RETRIEVAL_QUERIES,
  normalizeCreates,
  normalizeStackableTransfer,
  resolveSuggestionEmission,
  resolveSuggestionItems,
  substitutePiggybackIds,
  suggestionRefSchema,
  type PlannedStateBlock,
  type SubstitutedStateBlock,
  type TurnCreatesReport,
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
import { appSettingsStore } from '@/lib/stores'

import { classifierEmbedder } from './description-embedder'
import { readLastTurns } from './entry-reads'
import { buildGenerationContext } from './generation-context'
import { planTurnCreates } from './per-turn-creates'
import { loadPerTurnWorkingSet } from './working-set'

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

// Mirrors state-emission.ts's "found loose, spent on someone off-scene" — the roster
// header's "never invent one" otherwise pulls toward a plausible-but-wrong ID instead.
const TRANSFER_PARTY_DESCRIPTION =
  'Omit rather than inventing a roster ID — there is no other party when something is found loose or spent on someone off-scene.'

const NEW_HANDLE_PREFIX_DESCRIPTION =
  'A handle you choose, starting with "new:" (e.g. new:docks), so it is never mistaken for a listed ID.'
const NEW_LOCATION_HANDLE_DESCRIPTION = `${NEW_HANDLE_PREFIX_DESCRIPTION} Use it only in currentLocation and another new place's parent.`
const NEW_ITEM_HANDLE_DESCRIPTION = `${NEW_HANDLE_PREFIX_DESCRIPTION} Use it only in transfers.items[].id and sceneEntities.`

// A create follows the tags' rules: a wrong-typed handle or name reads as '', which
// normalizeCreates drops and counts. Not .catch(''): that emits `default: ""` to the model.
const createText = () =>
  z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string())

const isRecord = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// A create that isn't an object reads as an empty one, dropped and counted the same way; a lone
// create reads as a list of one, and any other list that isn't one as none.
const createList = <T extends z.ZodType>(create: T) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? value : isRecord(value) ? [value] : undefined),
    z.array(z.preprocess((value) => (isRecord(value) ? value : {}), create)).optional(),
  )

export const fallbackClassifierSchema = z.object({
  sceneEntities: z
    .array(z.string())
    .describe(
      'IDs of every character and item present in this scene — physically there in the last entry, not merely mentioned or remembered. An item you create appears here only by the exact handle it declares in newItems.',
    ),
  // newLocations before currentLocation and newItems before transfers, so an in-order model
  // declares those handles before it uses them.
  newLocations: createList(
    z.object({
      handle: createText().describe(NEW_LOCATION_HANDLE_DESCRIPTION),
      name: createText(),
      description: z
        .string()
        .optional()
        .catch(undefined)
        .describe('One short sentence describing the place.'),
      parent: z
        .string()
        .optional()
        .catch(undefined)
        .describe(
          'The place it is part of: its ID from Places when Places lists it, or the handle of another location in newLocations. Omit it for a top-level place.',
        ),
    }),
  ).describe(
    'Places this turn creates, when the scene settles somewhere not in Places. A new place is kept only as currentLocation or a place currentLocation is part of; any other is dropped.',
  ),
  currentLocation: z
    .string()
    .optional()
    .describe(
      'The ID of the place this scene happens at: its ID from Places when Places lists it, or the handle of a location in newLocations.',
    ),
  worldTimeDelta: z.number(),
  visualChanges: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(VISUAL_CHANGE_TYPES),
        text: z
          .string()
          .describe(
            'The FULL new value for the category named in `type` — this replaces whatever was there before, not a partial edit.',
          ),
      }),
    )
    .optional(),
  newItems: createList(
    z.object({
      handle: createText().describe(NEW_ITEM_HANDLE_DESCRIPTION),
      name: createText(),
      description: z
        .string()
        .optional()
        .catch(undefined)
        .describe('One short sentence describing the item.'),
    }),
  ).describe(
    'Items this turn creates, when a character takes or receives something new. A new item is kept only when the last transfers.items entry naming it gives it to a character; any other is dropped.',
  ),
  transfers: z
    .object({
      items: z
        .array(
          z.object({
            id: z
              .string()
              .describe("The item's ID from the list, or the handle of an item in newItems."),
            slot: z.enum(['equipped_items', 'inventory']),
            to: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
            from: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
          }),
        )
        .default([]),
      stackables: z
        .array(
          z.object({
            key: z.string().describe('Lowercase name of the stackable, e.g. gold.'),
            amount: z.number().describe('Quantity moved, not the resulting total.'),
            to: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
            from: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
          }),
        )
        .default([]),
    })
    .optional(),
  summary: z
    .string()
    .optional()
    .describe(
      'One sentence summarizing what happened in this turn. Used verbatim as a retrieval query next turn, so identify the people, places and things that mattered by name, not ID.',
    ),
  // retrieval.md → Q4: must never raise the parse — a raise costs a full extra classifier
  // call and, on failure, takes the mandatory summary down with it. Drops over-emission rather
  // than truncating: truncation needs .transform(), which breaks z.toJSONSchema.
  retrievalQueries: z
    .array(z.string())
    .max(MAX_RETRIEVAL_QUERIES)
    .optional()
    .catch(undefined)
    .describe(
      'Up to three short phrases naming context you want retrieved for the NEXT turn — what you would want looked up, not a recap of this one. Used verbatim as a retrieval query next turn, so identify the people, places and things by name, not ID.',
    ),
})

// Structured output validates the whole object in one shot, so without
// .catch([]) a malformed suggestions array would fail the entire classifier
// parse and take the (unrelated) scene-state fields down with it. The element
// is shared with suggestion-refresh; only this array policy is local.
const suggestionFieldSchema = z.array(suggestionRefSchema).catch([])

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
  prompt: PromptHalves,
  schema: z.ZodType<T>,
  config: ResolveModelConfig,
  abortSignal: AbortSignal,
  options: StructuredCallOptions,
): Promise<GenerateStructuredResult<T>> {
  const classify = () =>
    generateStructured('classifier', prompt, schema, config, abortSignal, options)
  const first = await classify()
  if (first.status !== 'ok' || first.value.worldTimeDelta >= 0) return first
  const reroll = await classify()
  return reroll.status === 'ok' ? reroll : first
}

export async function* piggybackFallbackClassifierPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  // Ahead of the working set on purpose: a run whose narrative fold already
  // produced the block does nothing here, so there is no store state for it to
  // be out of sync with.
  const outcome = ctx.intermediates.piggybackOutcome as PiggybackOutcome | undefined
  if (!shouldFallbackFire(outcome)) return { status: 'completed' }

  const working = loadPerTurnWorkingSet(ctx, PIGGYBACK_FALLBACK_PHASE_NAME)
  if (!working.ok) return working.result
  const { open, entities } = working.set

  // Same query at the floor width: the read is tail-anchored, so `.at(-1)`/`.at(-2)`
  // match the wider window the prompt was built from (generation-context.ts).
  const turns = await readLastTurns(ctx.db, ctx.branchId)
  const tail = turns.at(-1)
  if (!tail) return { status: 'completed' }
  const previousEntry = turns.at(-2)

  const suggestionEmission = resolveSuggestionEmission(open.settings)
  // Only ask when chips aren't already in hand: a <state>-failed /
  // <suggestions>-ok turn fires this phase for state alone, and re-rolling
  // would overwrite good chips with a second opinion.
  const suggestionsAlreadyCaptured = ctx.intermediates.suggestionsCaptured === true
  const askForSuggestions = suggestionEmission.settingsAllowEmission && !suggestionsAlreadyCaptured

  // Same context builder + template pattern as the narrative phase
  // (lib/pipeline/definitions/per-turn.ts) — the classifier is a
  // story-related prompt like any other, not a special case. Its template
  // renders `lastTurns` rather than `entries`: the user's action can itself
  // carry state changes ("I put the sword away"), not just the AI's reply, and
  // that pair is a fixed contract the story's buffer knobs must not cut.
  const load = await buildGenerationContext(ctx, {
    phaseName: PIGGYBACK_FALLBACK_PHASE_NAME,
    templateId: TEMPLATE_IDS.piggybackFallbackClassifier,
    suggestionsFire: askForSuggestions,
  })
  if (!load.ok) return load.result
  // Run-scoped, so placeholder ids stay consistent with the narrative fold's
  // prompt instead of being renumbered from scratch.
  const { idMap } = load
  const prompt = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, load.context)

  const appSettings = appSettingsStore.getAppSettings()
  const classifierConfig: ResolveModelConfig = {
    providers: appSettings.providers,
    profiles: appSettings.profiles,
    assignments: appSettings.assignments,
    storyModels: open.settings.models,
  }
  // Only the turn's regular classifier recurs per turn, so only it caches the system prefix;
  // a failed-piggyback recovery doesn't (piggyback.md → Fallback classifier context).
  const callOptions: StructuredCallOptions = { cacheSystemPrefix: !outcome?.attempted }
  const result = askForSuggestions
    ? await generateClassifierState(
        prompt,
        fallbackClassifierWithSuggestionsSchema,
        classifierConfig,
        ctx.abortSignal,
        callOptions,
      )
    : await generateClassifierState(
        prompt,
        fallbackClassifierSchema,
        classifierConfig,
        ctx.abortSignal,
        callOptions,
      )

  // A cancelled run discards its writes rather than recording them as a classifier
  // failure. The signal as well as the status: generateClassifierState returns the
  // first (ok) result when it is the re-roll that got cancelled.
  if (ctx.abortSignal.aborted || result.status === 'aborted') return { status: 'aborted' }

  // `layer` names whoever supplied the fields the report carries. The prior report, when
  // there is one, is the narrative fold's FAILED attempt: its failedFields and raw
  // survive so the parse failure stays inspectable, and its layer survives only where
  // this phase produced no fields of its own to replace them with
  // (docs/data-model.md → Entry metadata shape).
  const priorReport = tail.metadata?.stateReport

  if (result.status !== 'ok') {
    ctx.log.warn('classifier.piggyback_fallback_failed', {
      status: result.status,
      ...('kind' in result ? { errorKind: result.kind } : {}),
      ...('detail' in result ? { errorDetail: result.detail } : {}),
    })
    const classifierFailure = {
      field: 'classifier',
      detail:
        'kind' in result
          ? `classifier call ${result.status}: ${result.kind}`
          : `classifier call ${result.status}`,
    }
    // Amended rather than rebuilt. The call returned nothing, so every field the report
    // carries is still the fold's — including the visual changes and transfers apply.ts
    // already wrote as entity rows, which an empty-block rebuild would drop and leave
    // the record contradicting world state. Where the fold produced no report at all
    // (piggyback off, or a block that parsed nothing), this phase is the only writer:
    // returning silently leaves a row the panel cannot tell from one where nothing
    // changed, and the warn above is a no-op unless diagnostics is on.
    const failedReport = priorReport
      ? { ...priorReport, failedFields: [...(priorReport.failedFields ?? []), classifierFailure] }
      : { layer: 'per_turn_classifier' as const, failedFields: [classifierFailure] }
    yield {
      type: 'delta_emitted',
      action: {
        kind: 'updateStoryEntryMetadata',
        source: 'per_turn_classifier',
        payload: {
          branchId: ctx.branchId,
          id: tail.id,
          metadata: { stateReport: failedReport },
        },
      },
    }
    return { status: 'completed' }
  }

  // Tagged-parser rule: a create with no usable handle or name is dropped and counted, not failed.
  const normalized = normalizeCreates(result.value)
  if (normalized.malformed > 0) {
    ctx.log.warn('classifier.create_malformed', {
      entryId: tail.id,
      count: normalized.malformed,
      layer: 'per_turn_classifier',
    })
  }
  // Nothing rereads this reply, so a transfer with a bad ref drops alone.
  const {
    block: substituted,
    failures,
    droppedTransfers,
  } = substitutePiggybackIds(normalized.block, idMap, { entities, badRef: 'drop' })
  for (const dropped of droppedTransfers) {
    ctx.log.warn('classifier.transfer_dropped', { entryId: tail.id, ...dropped })
  }
  // The schema can't reject one bad stackable without failing the whole call, so the
  // transfers parseTransfers would drop are dropped here, before the actions and report.
  const resolvedBlock: SubstitutedStateBlock =
    substituted.transfers === undefined
      ? substituted
      : {
          ...substituted,
          transfers: {
            ...substituted.transfers,
            stackables: substituted.transfers.stackables.flatMap(
              (transfer) => normalizeStackableTransfer(transfer) ?? [],
            ),
          },
        }
  if (failures.length > 0) {
    ctx.log.warn('classifier.piggyback_fallback_parse_failed', {
      fields: failures.map((f) => f.field),
      failures: failures.map((f) => ({ field: f.field, errorDetail: f.detail })),
    })
  }

  const plan = await planTurnCreates({
    block: resolvedBlock,
    entities,
    mapCurrentLocationId: load.mapCurrentLocationId,
    branchId: ctx.branchId,
    source: 'per_turn_classifier',
    embed: classifierEmbedder(),
    now: () => Date.now(),
    newId: (prefix) => generateId(prefix),
    log: ctx.log,
  })
  // Matching an item can await an embed call; a cancel during it discards this phase's writes.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  const {
    metadata: scenePatch,
    actions,
    applied,
  } = buildPiggybackActions({
    entryId: tail.id,
    turn: plan,
    entities,
    previousMetadata: {
      ...inheritedEntryMetadata(previousEntry?.metadata),
      ...(previousEntry?.id ? { entryId: previousEntry.id } : {}),
    },
    branchId: ctx.branchId,
    source: 'per_turn_classifier',
  })

  // The narrative fold applies visual/transfer changes whenever it fires, parse failure
  // or not, so those rows are already written. A fallback that reports neither must not
  // blank them out of the record — same reason failedFields and raw survive its write.
  const reportedBlock: PlannedStateBlock = {
    ...plan.block,
    ...(plan.block.visualChanges === undefined && priorReport?.visualChanges !== undefined
      ? { visualChanges: priorReport.visualChanges }
      : {}),
    ...(plan.block.transfers === undefined && priorReport?.transfers !== undefined
      ? { transfers: priorReport.transfers }
      : {}),
  }
  // A failed fold reports its creates `dropped`: keep that list for a kind this phase's report
  // has none of (no-blanking rule), as when its only creates of that kind were malformed.
  const reportedCreates: TurnCreatesReport = {
    newLocations:
      plan.report.newLocations.length > 0
        ? plan.report.newLocations
        : (priorReport?.newLocations ?? []),
    newItems:
      plan.report.newItems.length > 0 ? plan.report.newItems : (priorReport?.newItems ?? []),
  }
  const stateReport = buildStateReport({
    layer: 'per_turn_classifier',
    turn: { block: reportedBlock, report: reportedCreates },
    failures: [
      ...(priorReport?.failedFields ?? []),
      ...failures.map((f) => ({ field: f.field, detail: f.detail })),
    ],
    applied,
    ...(priorReport?.raw !== undefined ? { raw: priorReport.raw } : {}),
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
    ctx.log.warn('classifier.suggestions_fallback_parse_failed', {
      received: rawSuggestions.length,
      dropped: droppedCount,
      resolved: suggestionItems.length,
      expected: suggestionEmission.count,
    })
  }

  // After the reply's create, before writes naming them: a reversal of the turn removes them.
  for (const action of plan.creates) {
    yield { type: 'delta_emitted', action }
  }
  yield {
    type: 'delta_emitted',
    action: {
      kind: 'updateStoryEntryMetadata',
      source: 'per_turn_classifier',
      payload: {
        branchId: ctx.branchId,
        id: tail.id,
        // Only what this phase computed: the handler merges onto the row it reads,
        // so spreading `tail.metadata` here would re-assert a snapshot taken before
        // the classifier call.
        metadata: {
          ...scenePatch,
          ...(stateReport !== undefined ? { stateReport } : {}),
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
