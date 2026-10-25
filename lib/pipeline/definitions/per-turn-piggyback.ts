import { z } from 'zod'

import { generateStructured, resolveModel, resolveModelCapabilities } from '@/lib/ai'
import type {
  GenerateStructuredResult,
  ModelCapabilities,
  PromptHalves,
  ResolveModelConfig,
  StructuredCallOptions,
} from '@/lib/ai'
import { inheritedEntryMetadata, type EntryMetadata } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { isJsonObject } from '@/lib/json-object'
import {
  buildPiggybackActions,
  buildStateReport,
  CLASSIFIER_FAILURE_FIELD,
  isDroppedRefField,
  MAX_RETRIEVAL_QUERIES,
  normalizeCreates,
  normalizeStackableTransfer,
  resolveSuggestionEmission,
  resolveSuggestionItems,
  substitutePiggybackIds,
  suggestionRefSchema,
  type DroppedRef,
  type ParsedTransfers,
  type PiggybackApplied,
  type StackableTransfer,
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

import { toPipelineError } from '../call-error'
import { classifierEmbedder } from './description-embedder'
import { readLastTurns, readStoryPlace } from './entry-reads'
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
const CREATE_CONDITION_DESCRIPTION =
  'Its condition, only when the turn shows one: the running consequence, not the event. Omit it otherwise.'

// A create follows the tags' rules: a wrong-typed handle or name reads as '', which
// normalizeCreates drops and counts. Not .catch(''): that emits `default: ""` to the model.
const createText = () =>
  z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string())

// A create that isn't an object reads as an empty one, dropped and counted the same way; a lone
// create reads as a list of one, and any other list that isn't one as none.
const createList = <T extends z.ZodType>(create: T) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? value : isJsonObject(value) ? [value] : undefined),
    z.array(z.preprocess((value) => (isJsonObject(value) ? value : {}), create)).optional(),
  )

const withoutNulls = (value: object): object =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null))

// Read as a create list is, an entry's null field as absent.
function listEntries(value: unknown): unknown[] | undefined {
  const list = Array.isArray(value) ? value : isJsonObject(value) ? [value] : undefined
  return list?.map((item) => (isJsonObject(item) ? withoutNulls(item) : item))
}

/** A list entry the schema couldn't read, left in its place for the phase to record. */
class UnreadableEntry {
  constructor(readonly detail: string) {}
}

const issuesText = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.map(String).join('.')}: ${issue.message}`
        : issue.message,
    )
    .join('; ')

// The model is shown `entry` alone: one that fails it parses as an UnreadableEntry instead of failing
// the reply. zod calls a catch with no context for its JSON Schema default, so none is shown.
function tolerantEntry<T extends z.ZodType>(
  entry: T,
  list: string,
): z.ZodType<z.output<T> | UnreadableEntry> {
  return entry.catch(
    (ctx?: z.core.$ZodCatchCtx) =>
      (ctx === undefined
        ? undefined
        : new UnreadableEntry(`${list}: ${issuesText(ctx.error.issues)}`)) as z.output<T>,
  )
}

// A null single-value field reads as absent; not .nullable(), which changes the JSON Schema shown.
const nullAsOmitted = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema)

const conditionEntry = z.object({
  id: z.string().describe('The ID of a place or item shown above with its state.'),
  text: z
    .string()
    .describe(
      'Its condition as it is now, the running consequence rather than the event: keep what still applies, drop what no longer does, in a few words, never more than about 60. It replaces the stored condition whole.',
    ),
})

// piggyback.md → Trailing block format: put down somewhere else than the scene stays prose. Kept
// out unlogged: the schema has no logger.
const namesPlace = (item: unknown): boolean =>
  isJsonObject(item) && 'to' in item && typeof item.to === 'string' && item.to.trim() !== ''

const visualChangeEntry = z.object({
  id: z.string(),
  type: z.enum(VISUAL_CHANGE_TYPES),
  text: z
    .string()
    .describe(
      'The category named in `type` as it is now, restated from its current value shown above: keep what still applies, drop what no longer does, in about 60 words. It replaces the stored value whole.',
    ),
})

const itemMoveEntry = z.object({
  id: z.string().describe("The item's ID from the list, or the handle of an item in newItems."),
  slot: z.enum(['equipped_items', 'inventory']),
  to: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
  from: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
})

const stackableEntry = z.object({
  key: z
    .string()
    .describe(
      "The key exactly as the holder's Stackables line shows it, or a new lowercase name, e.g. gold, only for something they don't hold yet.",
    ),
  amount: z
    .number()
    .describe('Quantity moved, not the resulting total, and never more than the payer holds.'),
  to: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
  from: z.string().optional().describe(TRANSFER_PARTY_DESCRIPTION),
})

const dropEntry = z.object({
  id: z.string().describe("The item's ID from the list."),
  from: z
    .string()
    .optional()
    .describe('Who held it, when the turn says. Omit rather than inventing a roster ID.'),
})

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
          'The place it is part of: its ID from Places when Places lists it, or the handle of another location in newLocations; "top" only when nothing in Places could contain it. Omit it when something in Places could contain it and the turn doesn\'t say which; when unsure, omit it.',
        ),
      condition: z.string().optional().catch(undefined).describe(CREATE_CONDITION_DESCRIPTION),
    }),
  ).describe(
    'Places this turn creates, when the scene settles somewhere not in Places. A new place is kept only as currentLocation or a place currentLocation is part of; any other is dropped.',
  ),
  currentLocation: nullAsOmitted(
    z
      .string()
      .optional()
      .describe(
        'The ID of the place this scene happens at: its ID from Places when Places lists it, or the handle of a location in newLocations.',
      ),
  ),
  worldTimeDelta: z.number(),
  visualChanges: z.preprocess(
    listEntries,
    z.array(tolerantEntry(visualChangeEntry, 'visualChanges')).optional(),
  ),
  conditions: z
    .preprocess(listEntries, z.array(tolerantEntry(conditionEntry, 'conditions')).optional())
    .describe(
      "A place's or an item's condition, only when this turn changes it, and only for one shown above with its state: the current location, an item held in the scene or lying there, a place or item listed elsewhere in the world.",
    ),
  newItems: createList(
    z.object({
      handle: createText().describe(NEW_ITEM_HANDLE_DESCRIPTION),
      name: createText(),
      description: z
        .string()
        .optional()
        .catch(undefined)
        .describe('One short sentence describing the item.'),
      condition: z.string().optional().catch(undefined).describe(CREATE_CONDITION_DESCRIPTION),
    }),
  ).describe(
    'Items this turn creates, when a character takes or receives something new. A new item is kept only when the last transfers.items entry naming it gives it to a character; any other is dropped.',
  ),
  transfers: nullAsOmitted(
    z
      .object({
        items: z
          .preprocess(
            (value) => listEntries(value) ?? [],
            z.array(tolerantEntry(itemMoveEntry, 'transfers.items')),
          )
          .default([]),
        stackables: z
          .preprocess(
            (value) => listEntries(value) ?? [],
            z.array(tolerantEntry(stackableEntry, 'transfers.stackables')),
          )
          .default([]),
        drops: z
          .preprocess(
            (value) => listEntries(value)?.filter((drop) => !namesPlace(drop)) ?? [],
            z.array(tolerantEntry(dropEntry, 'transfers.drops')),
          )
          .default([])
          .describe(
            'Items someone holding them put down where the scene is and still lying there when the turn ends. An item picked up again, or put down anywhere else, is left out.',
          ),
      })
      .optional(),
  ),
  summary: nullAsOmitted(
    z
      .string()
      .optional()
      .describe(
        'One sentence summarizing what happened in this turn. Used verbatim as a retrieval query next turn, so identify the people, places and things that mattered by name, not ID.',
      ),
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
  log: PhaseContext['log'],
): Promise<GenerateStructuredResult<T>> {
  const classify = () =>
    generateStructured('classifier', prompt, schema, config, abortSignal, options)
  const first = await classify()
  if (first.status !== 'ok' || first.value.worldTimeDelta >= 0) return first
  const reroll = await classify()
  if (reroll.status === 'failed' || reroll.status === 'not-configured')
    log.warn('classifier.delta_reroll_failed', {
      status: reroll.status,
      ...('kind' in reroll ? { errorKind: reroll.kind } : {}),
      ...('detail' in reroll ? { errorDetail: reroll.detail } : {}),
      worldTimeDelta: first.value.worldTimeDelta,
    })
  const chosen = reroll.status === 'ok' ? reroll : first
  // Each call's retried attempts are reported, whichever result the turn keeps.
  const retried = reroll.status === 'not-configured' ? [] : reroll.recoverable
  return { ...chosen, recoverable: [...first.recoverable, ...retried] }
}

type FallbackReply = z.infer<typeof fallbackClassifierSchema>
type StateReport = NonNullable<EntryMetadata['stateReport']>

function readable<T>(
  entries: readonly (T | UnreadableEntry)[],
  field: DroppedRef['field'],
  dropped: DroppedRef[],
): T[] {
  return entries.flatMap((entry) => {
    if (!(entry instanceof UnreadableEntry)) return [entry]
    dropped.push({ field, reason: 'unreadable', detail: entry.detail })
    return []
  })
}

// The tags' parser's key and amount rules, which the schema can't state.
function usableStackables(
  stackables: readonly StackableTransfer[],
  dropped: DroppedRef[],
): StackableTransfer[] {
  return stackables.flatMap((stackable) => {
    const usable = normalizeStackableTransfer(stackable)
    if (usable === null)
      dropped.push({
        field: 'transfers',
        reason: 'unreadable',
        detail: `transfers.stackables: no usable key or amount (key ${JSON.stringify(stackable.key)}, amount ${stackable.amount})`,
      })
    return usable ?? []
  })
}

/**
 * The reply less each entry it can't use, which is returned as an `unreadable` dropped ref: an entry
 * its schema couldn't read, and a stackable the tags' parser would refuse.
 */
export function readFallbackReply(value: FallbackReply) {
  const dropped: DroppedRef[] = []
  const { visualChanges, conditions, transfers, ...rest } = value
  const reply = {
    ...rest,
    ...(visualChanges !== undefined
      ? { visualChanges: readable(visualChanges, 'visualChanges', dropped) }
      : {}),
    ...(conditions !== undefined
      ? { conditions: readable(conditions, 'conditions', dropped) }
      : {}),
    ...(transfers !== undefined
      ? {
          transfers: {
            items: readable(transfers.items, 'transfers', dropped),
            stackables: usableStackables(
              readable(transfers.stackables, 'transfers', dropped),
              dropped,
            ),
            // generateStructured parses with the schema's default; a value handed in unparsed may
            // lack it.
            drops: readable(transfers.drops ?? [], 'transfers', dropped),
          },
        }
      : {}),
  }
  return { reply, dropped }
}

type ReadTransfers = NonNullable<ReturnType<typeof readFallbackReply>['reply']['transfers']>

// The JSON has no tag order: items take `seq` by index, then drops.
function orderedTransfers(transfers: ReadTransfers): ParsedTransfers {
  return {
    items: transfers.items.map((item, seq) => ({ ...item, seq })),
    stackables: transfers.stackables,
    drops: transfers.drops.map((drop, i) => ({ ...drop, seq: transfers.items.length + i })),
  }
}

type ReportedTransfers = NonNullable<StateReport['transfers']>

// Item moves, stackables and drops each carry over on their own, so a fallback drop doesn't hide
// the fold's landed move; rows from the two writers never share one list.
function carriedTransfers(
  own: ReportedTransfers | undefined,
  prior: ReportedTransfers,
  applied: PiggybackApplied,
): ReportedTransfers {
  const drops = applied.dropsLanded > 0 ? own?.drops : prior.drops
  return {
    items: applied.itemsLanded > 0 ? (own?.items ?? []) : prior.items,
    stackables: applied.stackablesLanded > 0 ? (own?.stackables ?? []) : prior.stackables,
    ...(drops !== undefined ? { drops } : {}),
  }
}

// A failed fold lands its visual changes, conditions and transfers (bar drops it can't place), so
// each record stays unless something in this reply's list changed World too, as apply.ts counts it.
function withFoldChanges(
  report: StateReport | undefined,
  prior: StateReport | undefined,
  applied: PiggybackApplied,
): StateReport | undefined {
  const carried: Pick<StateReport, 'visualChanges' | 'conditions' | 'transfers'> = {
    ...(applied.visualChangesLanded === 0 && prior?.visualChanges !== undefined
      ? { visualChanges: prior.visualChanges }
      : {}),
    ...(applied.conditionsLanded === 0 && prior?.conditions !== undefined
      ? { conditions: prior.conditions }
      : {}),
    ...(prior?.transfers !== undefined
      ? { transfers: carriedTransfers(report?.transfers, prior.transfers, applied) }
      : {}),
  }
  if (Object.keys(carried).length === 0) return report
  return { ...(report ?? { layer: 'per_turn_classifier' as const }), ...carried }
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
  const callOptions: StructuredCallOptions = {
    cacheSystemPrefix: !outcome?.attempted,
    actionId: ctx.actionId,
  }
  const result = askForSuggestions
    ? await generateClassifierState(
        prompt,
        fallbackClassifierWithSuggestionsSchema,
        classifierConfig,
        ctx.abortSignal,
        callOptions,
        ctx.log,
      )
    : await generateClassifierState(
        prompt,
        fallbackClassifierSchema,
        classifierConfig,
        ctx.abortSignal,
        callOptions,
        ctx.log,
      )

  // generation-pipeline.md → Two retry tiers: one event per retried attempt, however the call ended.
  for (const attempt of result.status === 'not-configured' ? [] : result.recoverable)
    yield { type: 'recoverable_error', error: toPipelineError(attempt) }

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
      field: CLASSIFIER_FAILURE_FIELD,
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

  const { reply: readReply, dropped: unreadable } = readFallbackReply(result.value)
  // Tagged-parser rule: a create with no usable handle or name is dropped and counted, not failed.
  const { transfers: replyTransfers, ...reply } = readReply
  const normalized = normalizeCreates({
    ...reply,
    ...(replyTransfers !== undefined ? { transfers: orderedTransfers(replyTransfers) } : {}),
  })
  if (normalized.malformed > 0) {
    ctx.log.warn('classifier.create_malformed', {
      entryId: tail.id,
      count: normalized.malformed,
      layer: 'per_turn_classifier',
    })
  }
  // Nothing rereads this reply, so an entry with a bad ref drops alone, recorded in the report.
  const {
    block: substituted,
    failures,
    droppedRefs: refDrops,
  } = substitutePiggybackIds(normalized.block, idMap, { entities, badRef: 'drop' })
  // failedFields describes the narrative's attempt (data-model.md → Entry metadata shape), so this
  // reply's own field failures are recorded with its dropped refs.
  const droppedRefs: DroppedRef[] = [
    ...unreadable,
    ...refDrops,
    ...failures.flatMap((f): DroppedRef[] =>
      isDroppedRefField(f.field)
        ? [{ field: f.field, reason: 'unreadable', detail: f.detail }]
        : [],
    ),
  ]
  for (const dropped of [...unreadable, ...refDrops]) {
    ctx.log.warn('classifier.ref_dropped', { entryId: tail.id, ...dropped })
  }
  if (failures.length > 0) {
    ctx.log.warn('classifier.piggyback_fallback_parse_failed', {
      fields: failures.map((f) => f.field),
      failures: failures.map((f) => ({ field: f.field, errorDetail: f.detail })),
    })
  }

  const plan = await planTurnCreates({
    block: substituted,
    entities,
    mapCurrentLocationId: load.mapCurrentLocationId,
    // Below the reply, which a failed fold may already have given this turn's location.
    story: await readStoryPlace(ctx.db, ctx.branchId, tail.position),
    branchId: ctx.branchId,
    source: 'per_turn_classifier',
    embed: classifierEmbedder(),
    now: () => Date.now(),
    newId: (prefix) => generateId(prefix),
    log: ctx.log,
    signal: ctx.abortSignal,
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
    stateShownIds: load.stateShownIds,
    previousMetadata: {
      ...inheritedEntryMetadata(previousEntry?.metadata),
      ...(previousEntry?.id ? { entryId: previousEntry.id } : {}),
    },
    branchId: ctx.branchId,
    source: 'per_turn_classifier',
    log: ctx.log,
  })

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
  const stateReport = withFoldChanges(
    buildStateReport({
      layer: 'per_turn_classifier',
      turn: { block: plan.block, report: reportedCreates },
      failures: priorReport?.failedFields ?? [],
      droppedRefs,
      applied,
      ...(priorReport?.raw !== undefined ? { raw: priorReport.raw } : {}),
    }),
    priorReport,
    applied,
  )

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
  for (const action of plan.structural) {
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
