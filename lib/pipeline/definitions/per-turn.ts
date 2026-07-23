import { eq, sql } from 'drizzle-orm'

import { resolveModel, resolveModelCapabilities, streamText } from '@/lib/ai'
import { inheritedEntryMetadata, storyEntries, type EntryMetadata } from '@/lib/db'
import { generateId, IdBiMap } from '@/lib/ids'
import { buildPiggybackActions, parseStateBlock, substitutePiggybackIds } from '@/lib/piggyback'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import { buildGenerationContext } from './generation-context'
import {
  PIGGYBACK_FALLBACK_PHASE_NAME,
  PIGGYBACK_FALLBACK_RESOLVES,
  piggybackFallbackClassifierPhase,
  resolvePiggybackFires,
} from './per-turn-piggyback'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

export const PER_TURN_KIND = 'per-turn'

async function* narrativePhase(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const { branchId, storyId } = ctx
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId || open.storyId !== storyId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'per-turn: no open story for branch' },
    }

  // Defense-in-depth against store desync: currentStoryStore is guarded above,
  // but the entry buffer + worldTime tail read from entriesStore — a future
  // multi-branch/background path hydrating it elsewhere would otherwise feed a
  // silent degenerate prompt.
  if (entriesStore.getLoadedBranch() !== branchId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'per-turn: entries store loaded for another branch' },
    }

  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === branchId)
    .sort((a, b) => a.position - b.position)
  const entities = [...entitiesStore.getEntities().values()].filter((e) => e.branchId === branchId)

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

  const idMap = new IdBiMap()
  ctx.intermediates.idMap = idMap
  const context = buildGenerationContext({
    entries,
    entities,
    definition: open.definition,
    settings: open.settings,
    idMap,
    piggybackFires: piggybackShouldFire,
  })
  const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, context)

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
    return {
      status: 'failed',
      error: {
        kind: 'provider',
        reason: 'network',
        detail: streamError instanceof Error ? streamError.message : String(streamError),
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
  const parseFailures = [...parsedState.failures, ...substitutionFailures]

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

  ctx.intermediates.piggybackOutcome = {
    attempted: piggybackShouldFire,
    succeeded: piggybackShouldFire && piggybackParseSucceeded,
  }

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
          content,
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
    definePipeline({
      kind: PER_TURN_KIND,
      phases: [
        { name: 'user-action-translation', run: userActionTranslationPhase },
        { name: 'narrative', run: narrativePhase, resolves: [{ target: 'narrative' }] },
        {
          name: PIGGYBACK_FALLBACK_PHASE_NAME,
          run: piggybackFallbackClassifierPhase,
          resolves: PIGGYBACK_FALLBACK_RESOLVES,
        },
      ],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: { blockedBy: ['per-turn', 'chapter-close'] },
    })
  }
}
