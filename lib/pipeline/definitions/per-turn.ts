import { APICallError } from 'ai'
import { eq, sql } from 'drizzle-orm'

import { describeProviderError, resolveModel, resolveModelCapabilities, streamText } from '@/lib/ai'
import { inheritedEntryMetadata, storyEntries, type EntryMetadata } from '@/lib/db'
import { redactUrl } from '@/lib/diagnostics'
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
} from '@/lib/piggyback'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore } from '@/lib/stores'

import { buildGenerationContext } from './generation-context'
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
    defaultProviderId: cfg.defaultProviderId,
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
  // streamText (ai@6) does NOT throw from textStream on a network/connection failure —
  // it terminates iteration silently and surfaces the error only via onError. Capture it
  // there and gate the commit on it.
  const call = streamText('narrative', {
    prompt,
    config: {
      providers: cfg.providers,
      profiles: cfg.profiles,
      assignments: cfg.assignments,
      defaultProviderId: cfg.defaultProviderId,
      storyModels: open.settings.models,
    },
    abortSignal: ctx.abortSignal,
    actionId: ctx.actionId,
    onError: ({ error }) => {
      streamError = error
    },
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
  // same idMap the prompt was built with before anything looks them up.
  const { block: resolvedBlock, failures: substitutionFailures } = substitutePiggybackIds(
    parsedState.block,
    idMap,
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
  let piggybackApplied: ReturnType<typeof buildPiggybackActions> | undefined
  if (piggybackShouldFire) {
    piggybackApplied = buildPiggybackActions({
      entryId,
      block: resolvedBlock,
      entities,
      previousMetadata: {
        ...inherited,
        ...(tail?.id ? { entryId: tail.id } : {}),
      },
      branchId,
      source: 'piggyback_tagged_block',
    })
  }

  // Gated on the phase having actually applied the block: a model piggyback was not
  // enabled for can still emit a <state>, and a report badged with this layer would
  // name an agent that supplied nothing. The fallback writes its own report instead.
  const stateReport =
    piggybackApplied !== undefined
      ? buildStateReport({
          layer: 'piggyback_tagged_block',
          block: resolvedBlock,
          failures: parseFailures,
          applied: piggybackApplied.applied,
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
    ...(piggybackApplied?.metadata ?? inherited),
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

  if (piggybackApplied) {
    for (const action of piggybackApplied.actions) {
      yield { type: 'delta_emitted', action }
    }
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
      concurrencyPolicy: { blockedBy: ['per-turn', 'chapter-close'] },
    })
  }
}
