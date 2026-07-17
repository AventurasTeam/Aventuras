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
  const { branchId } = ctx
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId)
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
  })
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
  const startedAt = Date.now()
  let streamError: unknown
  const stream = streamProviderCall({
    model,
    prompt,
    abortSignal: ctx.abortSignal,
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

export function ensurePerTurnPipelineRegistered(): void {
  try {
    getPipeline(PER_TURN_KIND)
  } catch {
    definePipeline({
      kind: PER_TURN_KIND,
      phases: [{ name: 'narrative', run: narrativePhase, resolves: [{ target: 'narrative' }] }],
      affordance: 'pill-only',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  }
}
