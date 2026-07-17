import { eq, sql } from 'drizzle-orm'

import { getModel, resolveModel, streamProviderCall } from '@/lib/ai'
import { storyEntries, type EntryMetadata } from '@/lib/db'
import { generateId, IdBiMap } from '@/lib/ids'
import {
  definePipeline,
  getPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import { buildPerTurnGenerationContext } from './context'

export const PER_TURN_KIND = 'per-turn'

async function* narrativePhase(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const { branchId, storyId } = ctx
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId || open.storyId !== storyId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'per-turn: no open story for branch' },
    }

  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === branchId)
    .sort((a, b) => a.position - b.position)
  const entities = [...entitiesStore.getEntities().values()].filter((e) => e.branchId === branchId)

  const idMap = new IdBiMap()
  ctx.intermediates.idMap = idMap
  const context = buildPerTurnGenerationContext({
    entries,
    entities,
    definition: open.definition,
    settings: open.settings,
    idMap,
  })
  const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, context)

  const cfg = appSettingsStore.getAppSettings()
  const resolved = resolveModel('narrative', {
    providers: cfg.providers,
    profiles: cfg.profiles,
    assignments: cfg.assignments,
    defaultProviderId: cfg.defaultProviderId,
    storyModels: open.settings.models,
  })
  // Preflight halts before this phase on a broken resolver, so a failure here only
  // covers a resolver-time race the preflight snapshot missed — surface it, don't fabricate.
  if (!resolved.ok)
    return {
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: resolved.kind,
        target: resolved.target,
        phaseName: 'narrative',
      },
    }

  const entryId = generateId('entry')
  const model = getModel(resolved.providerId, resolved.modelId, ctx.actionId)
  const provider = cfg.providers.find((candidate) => candidate.id === resolved.providerId)
  const startedAt = Date.now()
  let streamError: unknown
  // streamText (ai@6) does NOT throw from textStream on a network/connection failure —
  // it terminates iteration silently and surfaces the error only via onError. Capture it
  // there and gate the commit on it.
  const stream = streamProviderCall({
    model,
    prompt,
    abortSignal: ctx.abortSignal,
    ...(resolved.params.temperature !== undefined
      ? { temperature: resolved.params.temperature }
      : {}),
    ...(resolved.params.maxOutput !== undefined
      ? { maxOutputTokens: resolved.params.maxOutput }
      : {}),
    ...(resolved.params.thinking !== undefined && provider?.type === 'anthropic'
      ? {
          providerOptions: {
            anthropic: {
              thinking:
                resolved.params.thinking > 0
                  ? { type: 'enabled', budgetTokens: resolved.params.thinking }
                  : { type: 'disabled' },
            },
          },
        }
      : {}),
    ...(resolved.params.timeout !== undefined
      ? { timeout: { totalMs: resolved.params.timeout * 1000 } }
      : {}),
    onError: ({ error }) => {
      streamError = error
    },
  })
  let content = ''
  try {
    for await (const chunk of stream.textStream) {
      content += chunk
      yield { type: 'stream_chunk', targetEntryId: entryId, text: chunk }
    }
  } catch (e) {
    streamError = e
  }
  if (streamError !== undefined) {
    // A cancel rides the same error path; classify it as abort, not provider failure,
    // so CTRL-Z semantics stay distinct from a real fault.
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
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
  // Inherited from the tail entry — by submitTurn ordering that is the just-written
  // user_action, which carries the inherited worldTime (see submit-turn.ts). M2 has no
  // time advancement, so this propagates the opening's worldTime forward.
  const worldTime = tail?.metadata?.worldTime ?? 0
  const metadata: EntryMetadata = {
    ...(usage
      ? {
          tokens: {
            prompt: usage.inputTokens ?? 0,
            completion: usage.outputTokens ?? 0,
            ...(usage.reasoningTokens != null ? { reasoning: usage.reasoningTokens } : {}),
          },
        }
      : {}),
    model: resolved.modelId,
    generationTimingMs: Date.now() - startedAt,
    ...(reasoningText ? { reasoning: reasoningText } : {}),
    // M2: scene membership + current location are piggyback/classifier-emitted (M3+); empty here.
    sceneEntities: [],
    currentLocationId: null,
    worldTime,
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
      ],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: { blockedBy: ['per-turn', 'chapter-close'] },
    })
  }
}
