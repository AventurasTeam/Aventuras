import { APICallError } from 'ai'
import { eq, sql } from 'drizzle-orm'

import { describeProviderError, resolveModel, resolveModelCapabilities, streamText } from '@/lib/ai'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { inheritedEntryMetadata, storyEntries, type EntryMetadata } from '@/lib/db'
import { redactUrl, type Logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import {
  buildPiggybackActions,
  buildStateReport,
  parseStateBlock,
  parseSuggestionsBlock,
  type ParseFieldFailure,
  resolveSuggestionEmission,
  resolveSuggestionItems,
  stripTrailingBlocks,
  substitutePiggybackIds,
  type SubstitutedStateBlock,
} from '@/lib/piggyback'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore } from '@/lib/stores'

import { classifierEmbedder } from './description-embedder'
import { readStoryPlace } from './entry-reads'
import { buildGenerationContext } from './generation-context'
import { nextMemoryRun } from './memory-chain'
import { planTurnCreates, skipTurnCreates, type TurnCreatePlan } from './per-turn-creates'
import {
  PIGGYBACK_FALLBACK_PHASE_NAME,
  PIGGYBACK_FALLBACK_RESOLVES,
  piggybackFallbackClassifierPhase,
  resolvePiggybackFires,
} from './per-turn-piggyback'
import { RETRIEVAL_PHASE_NAME, retrievalPhase } from './per-turn-retrieval'
import { loadPerTurnWorkingSet } from './working-set'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import type { PhaseContext, PhaseEmittedEvent, PhaseNode, PhaseResult } from '../types'

export const PER_TURN_KIND = 'per-turn'

// The status pill's phase mapping is exhaustive over this union and the phase
// list below is typed by it, so a phase added to the turn cannot reach the
// user unlabelled (generation-status-pill.md → Copy mapping).
export type PerTurnPhaseName =
  | 'user-action-translation'
  | typeof RETRIEVAL_PHASE_NAME
  | 'narrative'
  | typeof PIGGYBACK_FALLBACK_PHASE_NAME

// piggyback.md → Parse strategy and failure recovery: a failed fold holds back for the fallback what
// isn't idempotent, as it holds its creates: stackables add, so a repeat would move them twice, and
// drops it can't place, which here would land at the last place the fallback may yet resolve.
function skipFailedFold(
  block: SubstitutedStateBlock,
  failures: readonly ParseFieldFailure[],
  entryId: string,
  log: Logger,
): TurnCreatePlan {
  const turn = skipTurnCreates(block, log)
  const transfers = turn.block.transfers
  if (!transfers) return turn
  const locationFailed = failures.some((f) => f.field === 'currentLocation')
  const locationSkipped =
    block.currentLocation !== undefined && turn.block.currentLocation === undefined
  const holdDrops = (locationFailed || locationSkipped) && transfers.drops.length > 0
  const holdStackables = transfers.stackables.length > 0
  if (holdDrops)
    log.debug('classifier.drops_held', { entryId, itemIds: transfers.drops.map((d) => d.id) })
  if (holdStackables)
    log.debug('classifier.stackables_held', {
      entryId,
      keys: transfers.stackables.map((s) => s.key),
    })
  if (!holdDrops && !holdStackables) return turn
  const held = {
    ...transfers,
    ...(holdDrops ? { drops: [] } : {}),
    ...(holdStackables ? { stackables: [] } : {}),
  }
  return { ...turn, block: { ...turn.block, transfers: held } }
}

// A provider can send an error part and then stall: the stall fails the reply, the error says why.
function narrativeTimeoutDetail(timeoutMs: number | undefined, earlierError: unknown): string {
  const timeout = `narrative: timeout after ${timeoutMs}ms`
  return earlierError === undefined
    ? timeout
    : `${timeout}; earlier stream error: ${describeProviderError(earlierError)}`
}

async function* narrativePhase(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const { branchId } = ctx
  const working = loadPerTurnWorkingSet(ctx, 'narrative')
  if (!working.ok) return working.result
  const { open, entries, entities } = working.set

  const cfg = appSettingsStore.getAppSettings()

  // Resolved ahead of the call (not just from the post-call providerId/modelId)
  // so the prompt itself can skip the state-emission apparatus when we already
  // know this turn's tagged block would be thrown away — piggyback off, or the
  // resolved model isn't capability-flagged reliable, means the per-turn
  // fallback classifier redoes the extraction from scratch regardless
  // (docs/memory/piggyback.md → Capability gate). Pure resolution over the same
  // config streamText resolves internally, so the two can't disagree.
  const resolvedNarrativeModel = resolveModel('narrative', {
    providers: cfg.providers,
    profiles: cfg.profiles,
    assignments: cfg.assignments,
    storyModels: open.settings.models,
  })
  const narrativeCapabilities = resolvedNarrativeModel.ok
    ? resolveModelCapabilities(
        resolvedNarrativeModel.providerId,
        resolvedNarrativeModel.modelId,
        cfg.providers,
      )
    : undefined
  const piggybackShouldFire = resolvePiggybackFires({
    piggybackMode: open.settings.piggybackMode ?? 'off',
    narrativeModelCapabilities: narrativeCapabilities,
  })

  // Suggestions ride the same tagged emission as <state>, so they require it to
  // be firing at all — separate from whether the story wants chips.
  const suggestionEmission = resolveSuggestionEmission(open.settings)
  const suggestionsShouldFire = piggybackShouldFire && suggestionEmission.settingsAllowEmission

  const load = await buildGenerationContext(ctx, {
    phaseName: 'narrative',
    templateId: TEMPLATE_IDS.perTurnNarrative,
    piggybackFires: piggybackShouldFire,
    suggestionsFire: suggestionsShouldFire,
  })
  if (!load.ok) return load.result
  const { idMap } = load
  const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, load.context)

  const entryId = generateId('entry')
  const startedAt = Date.now()
  let streamError: unknown
  let errorBeforeTimeout: unknown
  // Assigned once the call returns; onError fires only while the stream runs.
  let timedOut = (): boolean => false
  // streamText (ai@6) does NOT throw from textStream on a network/connection failure —
  // it terminates iteration silently and surfaces the error only via onError. Capture it
  // there and gate the commit on it.
  const call = streamText('narrative', {
    prompt,
    config: {
      providers: cfg.providers,
      profiles: cfg.profiles,
      assignments: cfg.assignments,
      storyModels: open.settings.models,
    },
    abortSignal: ctx.abortSignal,
    actionId: ctx.actionId,
    onError: ({ error }) => {
      streamError = error
      // Native fetch rejects an aborted read with a plain error: one after expiry is the bound's.
      if (!timedOut()) errorBeforeTimeout ??= error
    },
    cacheSystemPrefix: true,
  })
  // Preflight halts before this phase on a broken resolver, so a failure here only
  // covers a resolver-time race the preflight snapshot missed — surface it, don't fabricate.
  if (!call.ok)
    return {
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: call.kind,
        target: call.target,
        phaseName: 'narrative',
      },
    }
  const { stream } = call
  timedOut = call.timedOut
  let content = ''
  try {
    // fullStream, not textStream: reasoning deltas stream to the UI as the
    // model thinks instead of appearing only post-hoc in metadata.
    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta') {
        content += part.text
        yield { type: 'stream_chunk', targetEntryId: entryId, text: part.text, channel: 'text' }
      } else if (part.type === 'reasoning-delta') {
        yield {
          type: 'stream_chunk',
          targetEntryId: entryId,
          text: part.text,
          channel: 'reasoning',
        }
      }
    }
  } catch (e) {
    streamError = e
  }
  // Checked unconditionally, not only under streamError: fullStream ends
  // GRACEFULLY on abort (an 'abort' part, no throw, no onError), so gating on
  // an error would fall through and commit the partial entry a cancel was
  // supposed to discard.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }
  // Ends the same graceful way, so without this the reply so far would commit as whole.
  if (timedOut())
    return {
      status: 'failed',
      error: {
        kind: 'provider',
        reason: 'timeout',
        detail: narrativeTimeoutDetail(call.timeoutMs, errorBeforeTimeout),
      },
    }
  if (streamError !== undefined) {
    // The envelope message alone ("Failed to process successful response") names
    // nothing actionable, and the orchestrator's own pipeline.phase_failed
    // carries neither statusCode nor a URL. No body: httpCallSink already stores
    // it, capped. The URL is redacted — an OpenAI-compatible endpoint can pass
    // its key as a query param.
    ctx.log.error('provider.narrative_stream_failed', {
      detail: describeProviderError(streamError),
      ...(APICallError.isInstance(streamError)
        ? { statusCode: streamError.statusCode, url: redactUrl(streamError.url) }
        : {}),
    })
    return {
      status: 'failed',
      error: {
        kind: 'provider',
        reason: 'network',
        detail: describeProviderError(streamError),
      },
    }
  }

  // Provenance is best-effort — every field below is optional on EntryMetadata,
  // so a provider that omits usage/reasoning simply yields undefined.
  const usage = await Promise.resolve(stream.usage).catch(() => undefined)
  const reasoningText = await Promise.resolve(stream.reasoningText).catch(() => undefined)
  const tail = entries.at(-1)
  const inherited = inheritedEntryMetadata(tail?.metadata)

  const parsedState = parseStateBlock(content)
  // Fields inside parsedState.block still carry the model's bracketed-ID
  // placeholders (c1, l1, i1...); swap them back to real entity ids using the
  // same idMap the prompt was built with before anything looks them up. A ref of the wrong kind
  // fails its field like an unknown one, so the fallback rereads the prose.
  const { block: resolvedBlock, failures: substitutionFailures } = substitutePiggybackIds(
    parsedState.block,
    idMap,
    { entities, badRef: 'fail' },
  )
  // An omitted block is a failed attempt, not silence. parseStateBlock cannot tell the
  // difference on its own (piggyback-off turns legitimately carry no block), so the
  // failure is synthesised here, where the gate is known — without it the fallback's
  // recovered report is identical to a story running with piggyback switched off.
  const missingBlockFailure: ParseFieldFailure[] =
    piggybackShouldFire && !parsedState.blockFound
      ? [{ field: 'state', detail: 'no <state> block in the reply' }]
      : []
  const parseFailures = [...parsedState.failures, ...substitutionFailures, ...missingBlockFailure]

  // The column stores prose only (docs/memory/piggyback.md → Persistence and
  // stripping); everything the block carried is persisted structurally instead.
  const { prose, stateRaw, outOfPosition } = stripTrailingBlocks(content)
  if (outOfPosition) ctx.log.warn('classifier.state_block_out_of_position', { entryId })
  // A reply that is nothing but a block strips to nothing. Persist the raw text
  // instead of committing a blank row: the reader strips it again at display, so
  // the entry reads the same either way, but the text stays recoverable.
  const proseEmpty = prose === '' && content.trim() !== ''
  if (proseEmpty) ctx.log.warn('classifier.reply_had_no_prose', { entryId })
  const persistedContent = proseEmpty ? content : prose

  const piggybackParseSucceeded = parsedState.blockFound && parseFailures.length === 0
  if (piggybackShouldFire && !piggybackParseSucceeded) {
    ctx.log.warn('classifier.piggyback_parse_failed', {
      blockFound: parsedState.blockFound,
      fields: parseFailures.map((f) => f.field),
    })
  }
  let fold: ({ turn: TurnCreatePlan } & ReturnType<typeof buildPiggybackActions>) | undefined
  if (piggybackShouldFire) {
    if (parsedState.malformedCreates > 0)
      ctx.log.warn('classifier.create_malformed', {
        entryId,
        count: parsedState.malformedCreates,
        layer: 'piggyback_tagged_block',
      })
    for (const drop of parsedState.dropsElsewhere)
      ctx.log.warn('classifier.drop_dropped', { entryId, drop, reason: 'to_named' })
    if (parsedState.dropsCutOff.length > 0)
      ctx.log.debug('classifier.drops_held', {
        entryId,
        itemIds: parsedState.dropsCutOff.map((d) => idMap.getUuidFor(d.id) ?? d.id),
        reason: 'cut_off',
      })
    // A failed fold creates nothing: creates aren't idempotent, and the fallback that fires
    // rewrites this turn's state, so a create made by both would leave a duplicate row.
    const turn = piggybackParseSucceeded
      ? await planTurnCreates({
          block: resolvedBlock,
          entities,
          mapCurrentLocationId: load.mapCurrentLocationId,
          // The reply isn't written yet, so the rows read the place the turn found.
          story: await readStoryPlace(ctx.db, branchId),
          branchId,
          source: 'piggyback_tagged_block',
          embed: classifierEmbedder(),
          now: () => Date.now(),
          newId: (prefix) => generateId(prefix),
          log: ctx.log,
          signal: ctx.abortSignal,
        })
      : skipFailedFold(resolvedBlock, parseFailures, entryId, ctx.log)
    // Matching an item can await an embed call; a cancel during it discards the reply.
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    fold = {
      turn,
      ...buildPiggybackActions({
        entryId,
        turn,
        entities,
        stateShownIds: load.stateShownIds,
        previousMetadata: {
          ...inherited,
          ...(tail?.id ? { entryId: tail.id } : {}),
        },
        branchId,
        source: 'piggyback_tagged_block',
        log: ctx.log,
      }),
    }
  }

  // Gated on the phase having actually applied the block: a model piggyback was not
  // enabled for can still emit a <state>, and a report badged with this layer would
  // name an agent that supplied nothing. The fallback writes its own report instead.
  const stateReport =
    fold !== undefined
      ? buildStateReport({
          layer: 'piggyback_tagged_block',
          turn: fold.turn,
          failures: parseFailures,
          applied: fold.applied,
          ...(stateRaw !== undefined ? { raw: stateRaw } : {}),
        })
      : undefined

  ctx.intermediates.piggybackOutcome = {
    attempted: piggybackShouldFire,
    succeeded: piggybackShouldFire && piggybackParseSucceeded,
  }

  const parsedSuggestions = suggestionsShouldFire
    ? parseSuggestionsBlock(content)
    : { items: [], blockFound: false, failed: false, malformedCount: 0 }
  const { items: suggestionItems, droppedCount } = resolveSuggestionItems(
    parsedSuggestions.items,
    suggestionEmission,
  )
  // Keys on items actually resolved, never on blockFound alone — a literal
  // "<suggestions>" string anywhere in prose would otherwise read as captured.
  const suggestionsCaptured = !parsedSuggestions.failed && suggestionItems.length > 0
  // Short counts as a problem, not just empty: one good chip beside two
  // malformed ones used to leave captured=true and dropped=0, so a model that
  // reliably under-delivers produced a permanently thin strip and no signal.
  const suggestionsShort = suggestionItems.length < suggestionEmission.count
  if (suggestionsShouldFire && (!suggestionsCaptured || droppedCount > 0 || suggestionsShort)) {
    ctx.log.warn('classifier.suggestions_parse_failed', {
      blockFound: parsedSuggestions.blockFound,
      failed: parsedSuggestions.failed,
      dropped: droppedCount,
      malformed: parsedSuggestions.malformedCount,
      resolved: suggestionItems.length,
      expected: suggestionEmission.count,
    })
  }
  ctx.intermediates.suggestionsCaptured = suggestionsCaptured

  const metadata: EntryMetadata = {
    ...(usage
      ? {
          tokens: {
            prompt: usage.inputTokens ?? 0,
            completion: usage.outputTokens ?? 0,
            ...(usage.outputTokenDetails?.reasoningTokens != null
              ? { reasoning: usage.outputTokenDetails.reasoningTokens }
              : {}),
          },
        }
      : {}),
    model: call.modelId,
    generationTimingMs: Date.now() - startedAt,
    ...(reasoningText ? { reasoning: reasoningText } : {}),
    ...(fold?.metadata ?? inherited),
    ...(stateReport !== undefined ? { stateReport } : {}),
    ...(suggestionsCaptured
      ? { nextTurnSuggestions: { items: suggestionItems, source: 'piggyback' as const } }
      : {}),
  }

  const [next] = await ctx.db
    .select({ next: sql<number>`COALESCE(MAX(${storyEntries.position}), 0) + 1` })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))

  yield {
    type: 'delta_emitted',
    entryId,
    action: {
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: {
          id: entryId,
          branchId,
          position: next?.next ?? 1,
          kind: 'ai_reply',
          content: persistedContent,
          chapterId: null,
          metadata,
          createdAt: Date.now(),
        },
      },
    },
  }

  // Right behind the reply's create and ahead of every write naming them: a regenerate sweeps
  // from that create's log position, so a row created before it would outlive the regenerate.
  for (const action of fold?.turn.structural ?? []) {
    yield { type: 'delta_emitted', action }
  }
  for (const action of fold?.actions ?? []) {
    yield { type: 'delta_emitted', action }
  }

  return { status: 'completed' }
}

// English is the fixed source language and no translation settings UI exists
// before M7.2, so this phase only ever takes the same-language short-circuit:
// the user_action content is already source-language, no translation row, no
// LLM call. The slot exists so the M8.1 real target->source call drops in here.
async function* userActionTranslationPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const open = currentStoryStore.getCurrentStory()
  const target = open?.settings.translation.targetLanguage ?? null
  if (target !== null && target !== 'en') {
    // Unreachable in M2 (no UI sets a non-en target); guard so M8.1 sees the seam.
    ctx.log.debug('translation.short_circuit_bypassed', { target })
  }
  return { status: 'completed' }
}

export function ensurePerTurnPipelineRegistered(): void {
  try {
    getPipeline(PER_TURN_KIND)
  } catch {
    const phases: readonly (PhaseNode & { name: PerTurnPhaseName })[] = [
      { name: 'user-action-translation', run: userActionTranslationPhase },
      { name: RETRIEVAL_PHASE_NAME, run: retrievalPhase },
      { name: 'narrative', run: narrativePhase, resolves: [{ target: 'narrative' }] },
      {
        name: PIGGYBACK_FALLBACK_PHASE_NAME,
        run: piggybackFallbackClassifierPhase,
        resolves: PIGGYBACK_FALLBACK_RESOLVES,
      },
    ]
    definePipeline({
      kind: PER_TURN_KIND,
      phases,
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: { blockedBy: [PER_TURN_KIND, PERIODIC_CLASSIFIER_KIND, 'chapter-close'] },
      chainsTo: nextMemoryRun,
    })
  }
}
