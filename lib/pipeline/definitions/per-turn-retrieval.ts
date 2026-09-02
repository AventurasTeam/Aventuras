import { boundedSignal } from '@/lib/abort'
import { inheritedEntryMetadata, queryRows } from '@/lib/db'
import { embedderReadDim } from '@/lib/embedder'
import {
  composeRetrievalEmbedDeps,
  refreshEmbeddingStatus,
  resolveStorySwapConfig,
} from '@/lib/embedder-swap'
import { generateId } from '@/lib/ids'
import { promptProse } from '@/lib/piggyback'
import { commitCaptureMode, reserveCaptureMode, writeProbeCapture } from '@/lib/probe'
import {
  countTokens,
  RANKER_DEFAULTS,
  readPromptBuffer,
  runRetrieval,
  type RetrievalOutcome,
} from '@/lib/retrieval'
import { appSettingsStore } from '@/lib/stores'

import { readSceneSource } from './entry-reads'
import { RETRIEVAL_INTERMEDIATE_KEY } from './intermediates'
import { loadPerTurnWorkingSet } from './working-set'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

export const RETRIEVAL_PHASE_NAME = 'retrieval'

// The two ways retrieval can find no usable embedder: unconfigured, and
// configured but never probed for its dim. Same tier, same envelope.
function embedderInitFailure(detail: string): PhaseResult {
  return { status: 'failed', error: { kind: 'embedder', reason: 'init', detail, staleCount: null } }
}

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

  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  const resolution = resolveStorySwapConfig(open.storyId, {
    modelId: open.settings.embedding_model_id,
    backend: open.settings.embeddingBackend,
    providerId: open.settings.embedding_provider_id,
  })
  if (!resolution.ok) return embedderInitFailure(`embedder not configured: ${resolution.reason}`)
  const dim = embedderReadDim(resolution.config)
  // Only an unprobed provider lands here. Guessing would KNN the wrong vec0 dim
  // family, which vec0 rejects with an opaque error rather than an empty result.
  if (dim === null)
    return embedderInitFailure(`embedder dim unknown for model ${resolution.config.modelId}`)

  const tail = entries.at(-1)
  // The row generation-context builds `sceneMetadata` from, so the pools are
  // scoped to the scene the prompt shows rather than to a second derivation off
  // whatever kind sits at the reader window's tail.
  const lastNarrative = await readSceneSource(ctx.db, branchId)
  const scene = inheritedEntryMetadata(lastNarrative?.metadata)
  const characterIds = new Set(entities.filter((e) => e.kind === 'character').map((e) => e.id))
  // retrieval.md → POV-awareness scope queries `sceneEntities ∩ characters`;
  // sceneEntities itself is kind-mixed (data-model.md → Entry metadata shape).
  const sceneCharacterIds = scene.sceneEntities.filter((id) => characterIds.has(id))

  // The same window generation-context composes for the prompt, so the capture
  // prices what the pools actually competed against rather than re-deriving the
  // mode rule. Priced on the prose alone: the per-turn template wraps entries in
  // bare newlines, so this reads as a lower bound the way the floor's own rows
  // do (probe.md → Structural floor).
  const promptBuffer = (await readPromptBuffer(ctx.db, branchId, open.settings))
    .map((e) => promptProse(e))
    .join('\n')

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
        // Reporting, not a gate: the sync it follows has already committed, so a
        // failed recount must not fail a turn that can still complete. The next
        // pass recounts from the flags rather than from anything stashed here.
        onRowsSynced: async () => {
          try {
            await refreshEmbeddingStatus(open.storyId, {
              db: ctx.db,
              runInTransaction: ctx.runInTransaction,
            })
          } catch (error) {
            ctx.log.warn('retrieval.status_refresh_failed', {
              detail: error instanceof Error ? error.message : String(error),
            })
          }
        },
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
          lastNarrativeContent: lastNarrative ? promptProse(lastNarrative) : '',
        },
        sceneCharacterIds,
        sceneEntityIds: scene.sceneEntities,
        currentLocationId: scene.currentLocationId,
        // Layer A scans the recent un-classified buffer prose (edge-cases.md →
        // Layer A — retrieval-time same-name suppression); the prompt buffer only
        // approximates that set, over-suppressing while classifierCadence stays
        // under partialChapterBuffer and under-suppressing past it (cadence.md →
        // User-tunable knobs).
        recentProse: promptBuffer,
      },
    )
  } finally {
    bounded.dispose()
  }

  // The OUTER signal, not the bounded one: reading the bounded one reports every
  // provider timeout as a phantom user-cancel. Still needed alongside the cancelled
  // arm below — an abort raised outside the embed has no outcome to carry it.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  const captureProbe = async (probed: RetrievalOutcome): Promise<void> => {
    // The app gate is live: getAppSettings() rebuilds from store state per call,
    // so a mid-pass toggle is honored (observability.md → Store ownership and
    // gate wiring). The story gate is the pass-start snapshot.
    const appGateOn = appSettingsStore.getAppSettings().diagnostics.enabled
    const storyGateOn = open.settings.probe_mode_active
    // Returning before the arm is spent is what keeps a gated turn from
    // spending a deep capture on a write that never happens.
    if (!appGateOn || !storyGateOn) return
    // target_entry_id is NOT NULL and carries no sentinel, so a capture with
    // nothing to attribute itself to would be unreadable in the probe surface.
    if (tail === undefined) {
      ctx.log.debug('retrieval.capture_skipped', { reason: 'branch has no entries' })
      return
    }

    const reservation = reserveCaptureMode()
    const status = await writeProbeCapture(
      { runInTransaction: ctx.runInTransaction },
      {
        id: generateId('pc'),
        branchId,
        // Keyed to the branch tail: the row this pass ran against, whatever kind it is.
        targetEntryId: tail.id,
        // Null in practice: the driving entry is an open-region row, and a
        // chapter id is stamped on at chapter-create time (data-model.md →
        // story_entries).
        chapterId: tail.chapterId,
        capturedAt: Date.now(),
        embeddingModelId: resolution.config.modelId,
        mode: reservation.mode,
        appGateOn,
        storyGateOn,
        params: RANKER_DEFAULTS,
        settings: {
          retrievalBudgets: open.settings.retrievalBudgets,
          fullChapterInBuffer: open.settings.fullChapterInBuffer,
          partialChapterBuffer: open.settings.partialChapterBuffer,
          protectedBuffer: open.settings.protectedBuffer,
        },
        promptBufferTokens: countTokens(promptBuffer),
        outcome: probed,
      },
    )
    // A failed write leaves the arm loaded: the deep capture the user asked for
    // has not happened yet, and silently downgrading the next turn to light is
    // indistinguishable from the arm never firing.
    if (status === 'written') commitCaptureMode(reservation)
  }

  if (!outcome.ok) {
    // Keeps a cancel off the failure surface even if a caller never checks the signal.
    if (outcome.cancelled) return { status: 'aborted' }
    const failure = bounded.expired()
      ? { ...outcome.failure, detail: `embed timed out after ${EMBED_TIMEOUT_MS}ms` }
      : outcome.failure
    ctx.log.warn('retrieval.embed_failed', {
      reason: failure.reason,
      staleCount: failure.staleCount,
    })
    await captureProbe(outcome)
    return { status: 'failed', error: { kind: 'embedder', ...failure } }
  }

  // AC7 wants the per-turn cost observable against the PoC baseline (~43 ms per
  // KNN query at 10k rows), so the KNN span is reported apart from the total.
  ctx.log.debug('retrieval.timing', outcome.timings)

  ctx.log.debug('retrieval.scores', {
    perType: Object.fromEntries(
      Object.entries(outcome.bundles).map(([type, bundle]) => [
        type,
        {
          pool: bundle.funnel.poolSize,
          kept: bundle.funnel.preFilteredSize,
          selected: bundle.funnel.selectedCount,
          tokens: bundle.funnel.tokensUsed,
          // MMR's first pick maximizes lambdaDiv * score with nothing selected
          // yet, so trace 0 carries the pass's highest final score.
          topScore: bundle.traces[0]?.finalScore ?? null,
        },
      ]),
    ),
  })

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
  await captureProbe(outcome)
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  // Downstream of the abort poll on purpose: bumping a cancelled turn's counters
  // leaves reverse-replay work for a turn that produced no prose.
  const bumpStartedAt = performance.now()
  for (const { id, retrievalCount } of outcome.injectedAwareness) {
    yield {
      type: 'delta_emitted',
      action: {
        kind: 'bumpAwarenessRetrieval',
        source: 'ai_classifier',
        payload: { branchId, id, priorCount: retrievalCount },
      },
    }
  }
  // Reported apart from outcome.timings, which measures the pass and returns
  // before any of this. One bump per aware in-scene character per seated
  // happening, each awaited by the orchestrator and each a handler read plus a
  // transaction — so this span is the turn's cost for the counters, and it is
  // spent before the narrative phase streams a word.
  if (outcome.injectedAwareness.length > 0)
    ctx.log.debug('retrieval.bump_dispatch', {
      count: outcome.injectedAwareness.length,
      ms: Math.round(performance.now() - bumpStartedAt),
    })
  return { status: 'completed' }
}
