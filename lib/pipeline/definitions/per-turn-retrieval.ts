import { inheritedEntryMetadata, queryRows, runInTransaction, type StoryEntry } from '@/lib/db'
import { embedderReadDim } from '@/lib/embedder'
import { composePromptBuffer, runRetrieval, type RetrievalOutcome } from '@/lib/retrieval'
import { currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

export const RETRIEVAL_PHASE_NAME = 'retrieval'

/** `ctx.intermediates` is `Record<string, unknown>`; consumers re-narrow with this pair. */
export const RETRIEVAL_INTERMEDIATE_KEY = 'retrieval'
export type RetrievalIntermediate = Extract<RetrievalOutcome, { ok: true }>

const NARRATIVE_KINDS = new Set<StoryEntry['kind']>(['ai_reply', 'opening'])

export async function* retrievalPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const { branchId } = ctx
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId || open.storyId !== ctx.storyId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'retrieval: no open story for branch' },
    }

  // Same defense-in-depth as narrativePhase: the scene, the buffer and the
  // entity kinds below all read the working-set stores, and rows hydrated for
  // another branch are dropped wholesale by the branch filter — a silently
  // degenerate pass rather than a failure.
  if (entriesStore.getLoadedBranch() !== branchId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'retrieval: entries store loaded for another branch' },
    }

  // Lazy: lib/actions' barrel reaches submitTurn, which imports lib/pipeline.
  // A module-eval import would close that require cycle and warn under Metro.
  const { composeRetrievalEmbedDeps, resolveStorySwapConfig } = await import('@/lib/actions')
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  const resolution = resolveStorySwapConfig(open.storyId, {
    modelId: open.settings.embedding_model_id,
    backend: open.settings.embeddingBackend,
    providerId: open.settings.embedding_provider_id,
  })
  if (!resolution.ok)
    return {
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: `embedder not configured: ${resolution.reason}`,
        staleCount: null,
      },
    }
  const dim = embedderReadDim(resolution.config)
  // Only an unprobed provider lands here. Guessing would KNN the wrong vec0 dim
  // family, which vec0 rejects with an opaque error rather than an empty result.
  if (dim === null)
    return {
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: `embedder dim unknown for model ${resolution.config.modelId}`,
        staleCount: null,
      },
    }

  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === branchId)
    .sort((a, b) => a.position - b.position)
  const entities = [...entitiesStore.getEntities().values()].filter((e) => e.branchId === branchId)

  const tail = entries.at(-1)
  const scene = inheritedEntryMetadata(tail?.metadata)
  const characterIds = new Set(entities.filter((e) => e.kind === 'character').map((e) => e.id))
  // retrieval.md → POV-awareness scope queries `sceneEntities ∩ characters`;
  // sceneEntities itself is kind-mixed (data-model.md → Entry metadata shape).
  const sceneCharacterIds = scene.sceneEntities.filter((id) => characterIds.has(id))

  const lastNarrative = entries.findLast((e) => NARRATIVE_KINDS.has(e.kind))

  const outcome = await runRetrieval(
    {
      // Retrieval reads one branch, and runRetrieval refuses a params.branchId
      // outside the sync scope declared here.
      branchIds: [branchId],
      queryAll: queryRows,
      runInTransaction,
      ...composeRetrievalEmbedDeps(resolution.config),
    },
    {
      branchId,
      modelId: resolution.config.modelId,
      dim,
      budgets: open.settings.retrievalBudgets,
      query: {
        // Q1 is THIS turn's action, which submitTurn commits immediately before
        // the run; anything else at the tail means the turn has none, and an
        // older action would embed as if it were current.
        userAction: tail?.kind === 'user_action' ? tail.content : '',
        // branch_era_flips has no writer wired, so no era can be named yet.
        eraName: null,
        piggybackSummary: lastNarrative?.metadata?.summary ?? null,
        lastNarrativeContent: lastNarrative?.content ?? '',
      },
      sceneCharacterIds,
      sceneEntityIds: scene.sceneEntities,
      currentLocationId: scene.currentLocationId,
      // Layer A scans the recent un-classified buffer prose (edge-cases.md →
      // Layer A — retrieval-time same-name suppression); the prompt buffer only
      // approximates that set, over-suppressing while classifierCadence stays
      // under partialChapterBuffer and under-suppressing past it (cadence.md →
      // User-tunable knobs).
      recentProse: composePromptBuffer(entries, open.settings)
        .map((e) => e.content)
        .join('\n'),
    },
  )

  // runRetrieval takes no signal, so a cancel raised during the pass is only
  // observable here — falling through hands narrativePhase an already-aborted
  // turn to open an LLM call on.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  if (!outcome.ok) {
    ctx.log.warn('retrieval.embed_failed', {
      reason: outcome.failure.reason,
      staleCount: outcome.failure.staleCount,
    })
    return { status: 'failed', error: { kind: 'embedder', ...outcome.failure } }
  }

  // staleCounts is a tripwire, not a report (lib/retrieval → RetrievalOutcome):
  // the sync stage is blocking and clears every flag it embeds, so a non-zero
  // count means its scope or its ops missed rows.
  if (Object.values(outcome.staleCounts).some((count) => count > 0))
    ctx.log.warn('retrieval.stale_after_sync', outcome.staleCounts)

  ctx.intermediates[RETRIEVAL_INTERMEDIATE_KEY] = outcome
  return { status: 'completed' }
}
