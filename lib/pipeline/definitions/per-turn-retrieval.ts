import { boundedSignal } from '@/lib/abort'
import { inheritedEntryMetadata, queryRows, type StoryEntry } from '@/lib/db'
import { embedderReadDim } from '@/lib/embedder'
import { composePromptBuffer, runRetrieval } from '@/lib/retrieval'

import { loadPerTurnWorkingSet } from './working-set'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

export const RETRIEVAL_PHASE_NAME = 'retrieval'

/** Where this phase parks its outcome; consumers re-narrow to `RetrievalSuccess`. */
export const RETRIEVAL_INTERMEDIATE_KEY = 'retrieval'

const NARRATIVE_KINDS = new Set<StoryEntry['kind']>(['ai_reply', 'opening'])

// Matches the periodic classifier's call budget: both bound one blocking
// provider call, and a turn already tolerates a narrative stream of this order.
const EMBED_TIMEOUT_MS = 300_000

export async function* retrievalPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const { branchId } = ctx
  const working = loadPerTurnWorkingSet(ctx, RETRIEVAL_PHASE_NAME)
  if (!working.ok) return working.result
  const { open, entries, entities } = working.set

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

  const tail = entries.at(-1)
  const scene = inheritedEntryMetadata(tail?.metadata)
  const characterIds = new Set(entities.filter((e) => e.kind === 'character').map((e) => e.id))
  // retrieval.md → POV-awareness scope queries `sceneEntities ∩ characters`;
  // sceneEntities itself is kind-mixed (data-model.md → Entry metadata shape).
  const sceneCharacterIds = scene.sceneEntities.filter((id) => characterIds.has(id))

  const lastNarrative = entries.findLast((e) => NARRATIVE_KINDS.has(e.kind))

  // A provider that accepts the connection and stalls would otherwise park the
  // turn forever holding the hard gate, with the pill still offering a Cancel
  // that reaches nothing.
  const bounded = boundedSignal(ctx.abortSignal, EMBED_TIMEOUT_MS)
  // finally, because runRetrieval rethrows anything outside the vector-invariant
  // family: without it every non-embedder fault leaks an armed timer and an
  // abort listener on the run signal.
  let outcome
  try {
    outcome = await runRetrieval(
      {
        abortSignal: bounded.signal,
        queryAll: queryRows,
        runInTransaction: ctx.runInTransaction,
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
  } finally {
    bounded.dispose()
  }

  // The OUTER signal, not the bounded one: an expiry aborts the pass the same
  // way a cancel does, but it is a provider fault. Reading the bounded signal
  // here would report every timeout as a phantom user-cancel — draft restored,
  // no error, no Switch embedder, retrying into the same dead provider.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  if (!outcome.ok) {
    const failure = bounded.expired()
      ? { ...outcome.failure, detail: `embed timed out after ${EMBED_TIMEOUT_MS}ms` }
      : outcome.failure
    ctx.log.warn('retrieval.embed_failed', {
      reason: failure.reason,
      staleCount: failure.staleCount,
    })
    return { status: 'failed', error: { kind: 'embedder', ...failure } }
  }

  // AC7 wants the per-turn cost observable against the PoC baseline (~43 ms per
  // KNN query at 10k rows), so the KNN span is reported apart from the total.
  ctx.log.debug('retrieval.timing', outcome.timings)

  // staleCounts is a tripwire, not a report (lib/retrieval → RetrievalOutcome):
  // the sync stage is blocking and clears every flag it embeds, so a non-zero
  // count means its scope or its ops missed rows.
  if (Object.values(outcome.staleCounts).some((count) => count > 0))
    ctx.log.warn('retrieval.stale_after_sync', outcome.staleCounts)

  // retrieval.md → Budget-fill termination wants a budget below its type's
  // overhead surfaced, not absorbed. Until the Story Settings warning exists,
  // this is the only signal that a type is seating nothing: candidates were
  // ranked and every one of them was dropped, which no prompt ever shows.
  for (const [type, bundle] of Object.entries(outcome.bundles)) {
    if (bundle.funnel.poolSize > 0 && bundle.funnel.selectedCount === 0)
      ctx.log.warn('retrieval.type_seated_nothing', {
        type,
        poolSize: bundle.funnel.poolSize,
        typeBudget: bundle.funnel.typeBudget,
      })
  }

  ctx.intermediates[RETRIEVAL_INTERMEDIATE_KEY] = outcome

  // Downstream of the abort poll on purpose: bumping a cancelled turn's counters
  // leaves reverse-replay work for a turn that produced no prose.
  for (const awarenessId of outcome.injectedAwarenessIds) {
    yield {
      type: 'delta_emitted',
      action: {
        kind: 'bumpAwarenessRetrieval',
        source: 'ai_classifier',
        payload: { branchId, id: awarenessId },
      },
    }
  }
  return { status: 'completed' }
}
