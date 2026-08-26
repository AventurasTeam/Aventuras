import { and, asc, eq, gt, sql } from 'drizzle-orm'

import { boundedSignal } from '@/lib/abort'
import { generateStructured } from '@/lib/ai'
import {
  buildClassifierActions,
  buildClassifierWindow,
  classifierExtractionSchema,
  IDLE_STATUS_JSON,
  idleStatus,
  nextStatusOnFailure,
  nextStatusOnStart,
  nextStatusOnSuccess,
  PERIODIC_CLASSIFIER_KIND,
  reconcileNewCharacter,
  substituteClassifierIds,
  type EmbedDescriptions,
  type ReconcileDecision,
} from '@/lib/classifier'
import { branches, storyEntries, type ClassifierStatus, type StoryEntry } from '@/lib/db'
import { generateId, IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore, entitiesStore, happeningsStore } from '@/lib/stores'

import { buildClassifierContext } from './classifier-context'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, ResolverInput } from '../types'

export { PERIODIC_CLASSIFIER_KIND }

export const PERIODIC_CLASSIFIER_RESOLVES: readonly ResolverInput[] = [{ target: 'classifier' }]

// Reconciliation degrades to create-with-flag rather than failing the pass when
// boot has not wired a real embedder.
const NO_EMBEDDER: EmbedDescriptions = async () => ({ vectors: [], dim: 0 })

// Injected so tests drive the similarity bands deterministically and so the
// embedder composition (config + provider resolution) stays in the action layer.
let embedDescriptions: EmbedDescriptions = NO_EMBEDDER
export function configureClassifierEmbedder(fn: EmbedDescriptions): void {
  embedDescriptions = fn
}
export function __resetClassifierEmbedder(): void {
  embedDescriptions = NO_EMBEDDER
}

// Straight from SQLite, never from entriesStore: that store holds only the last
// ENTRIES_WINDOW_SIZE entries, so a backlog older than the reader's window would
// be skipped outright and the watermark would advance past prose nobody classified.
// `maxEntries + 1` so buildClassifierWindow can still see the cut and set `truncated`.
async function readWindowEntries(
  ctx: PhaseContext,
  processedThrough: number | null,
  maxEntries: number,
): Promise<StoryEntry[]> {
  return (await ctx.db
    .select()
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, ctx.branchId),
        gt(storyEntries.position, processedThrough ?? 0),
      ),
    )
    .orderBy(asc(storyEntries.position))
    .limit(maxEntries + 1)) as StoryEntry[]
}

// The classifier is the one agent a user cannot cancel — the pill has no
// affordance for a background pass — and it persists `state: 'running'`, which
// gates both its own cadence and `runNow`. A provider that accepts the request
// and never answers therefore wedges it until the next boot. This bounds the
// whole structured call (retries included) so the expiry becomes an ordinary
// failure the existing backoff can act on. A profile `timeout` shorter than
// this still wins — the SDK aborts first; a longer one is deliberately capped.
const CALL_TIMEOUT_MS = 300_000

type StatusCtx = Pick<PhaseContext, 'db' | 'branchId'>

async function readStatus(ctx: StatusCtx): Promise<ClassifierStatus> {
  const [row] = await ctx.db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, ctx.branchId))
  return row?.classifierStatus ?? idleStatus()
}

async function writeStatus(ctx: StatusCtx, status: ClassifierStatus): Promise<void> {
  // branches is not delta-logged (classifier.md -> Persistence), so this is a
  // direct row write. Key-scoped json_set because the reversal clamp owns
  // $.processedThrough and can commit between this run's read and this write.
  await ctx.db.run(
    sql`UPDATE ${branches} SET classifier_status = json_set(
          COALESCE(classifier_status, ${IDLE_STATUS_JSON}),
          '$.state', ${status.state},
          '$.lastSuccessAt', ${status.lastSuccessAt},
          '$.lastError', ${status.lastError},
          '$.retryCount', ${status.retryCount}
        ) WHERE ${branches.id} = ${ctx.branchId}`,
  )
}

// Its own key-scoped write, for the mirror reason: it must not carry this run's
// snapshot of the lifecycle keys.
async function advanceWatermark(ctx: PhaseContext, coversThrough: number): Promise<void> {
  await ctx.db.run(
    sql`UPDATE ${branches} SET classifier_status = json_set(
          COALESCE(classifier_status, ${IDLE_STATUS_JSON}), '$.processedThrough',
          MAX(COALESCE(json_extract(classifier_status, '$.processedThrough'), 0), ${coversThrough})
        ) WHERE ${branches.id} = ${ctx.branchId}`,
  )
}

export async function* periodicClassifierPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== ctx.branchId || open.storyId !== ctx.storyId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'periodic-classifier: no open story for branch' },
    }
  const cfg = appSettingsStore.getAppSettings()
  const status = await readStatus(ctx)
  const entries = await readWindowEntries(
    ctx,
    status.processedThrough,
    cfg.classifierWindowMaxEntries,
  )
  const window = buildClassifierWindow({
    entries,
    processedThrough: status.processedThrough,
    maxEntries: cfg.classifierWindowMaxEntries,
  })
  if (window.isEmpty) {
    // coversThrough counts the capped candidates BEFORE the system-entry filter,
    // so a window of nothing but technical rows is empty yet still advanceable.
    // Leaving the watermark behind them re-fires the cadence forever.
    if (window.coversThrough > (status.processedThrough ?? 0))
      await advanceWatermark(ctx, window.coversThrough)
    return { status: 'completed' }
  }

  const entities = [...entitiesStore.getEntities().values()].filter(
    (e) => e.branchId === ctx.branchId,
  )
  const idMap = new IdBiMap()
  const prompt = renderTemplate(
    TEMPLATE_IDS.periodicClassifier,
    buildClassifierContext({
      window,
      entities,
      happenings: [...happeningsStore.getHappenings().values()].filter(
        (h) => h.branchId === ctx.branchId,
      ),
      idMap,
    }),
  )

  // Makes shouldCadenceFire's running guard live for the duration of the call.
  await writeStatus(ctx, nextStatusOnStart(status))

  const bounded = boundedSignal(ctx.abortSignal, CALL_TIMEOUT_MS)
  let result
  try {
    result = await generateStructured(
      'classifier',
      prompt,
      classifierExtractionSchema,
      {
        providers: cfg.providers,
        profiles: cfg.profiles,
        assignments: cfg.assignments,
        defaultProviderId: cfg.defaultProviderId,
        storyModels: open.settings.models,
      },
      bounded.signal,
    )
  } finally {
    bounded.dispose()
  }
  // Restore the pre-run status: an abort burns no retry state, and leaving
  // 'running' behind would permanently block shouldCadenceFire's guard.
  if (result.status === 'aborted' && !bounded.expired()) {
    await writeStatus(ctx, status)
    return { status: 'aborted' }
  }
  if (result.status !== 'ok') {
    // A expiry aborts the same way a cancel does, but it is a provider fault:
    // routing it through the abort arm would burn no retry and leave the pass
    // to rediscover the same dead provider on the next tick, forever.
    const detail =
      result.status === 'aborted'
        ? `timeout after ${CALL_TIMEOUT_MS}ms`
        : result.status === 'not-configured'
          ? result.kind
          : result.detail
    const timedOut = result.status === 'aborted'
    const { status: next } = nextStatusOnFailure(status, { error: detail, at: Date.now() })
    await writeStatus(ctx, next)
    return {
      status: 'failed',
      error: {
        kind: 'provider',
        reason: timedOut ? 'timeout' : 'unknown',
        detail: `classifier: ${timedOut ? 'timeout' : result.status}`,
      },
    }
  }

  // Abort-free from here: a reversal's 'cancel' either discarded the run above,
  // or lets this burst land for the positional sweep to reverse. Never return
  // aborted while holding deltas.
  const extraction = result.value
  const substituted = substituteClassifierIds(
    extraction,
    idMap,
    new Set(extraction.newCharacters.map((c) => c.handle)),
  )

  const decisions = new Map<string, ReconcileDecision>()
  for (const candidate of substituted.newCharacters) {
    decisions.set(
      candidate.handle,
      await reconcileNewCharacter(candidate, { entities, embedDescriptions }),
    )
  }

  const plan = buildClassifierActions(substituted, {
    branchId: ctx.branchId,
    window,
    entities,
    decisions,
    now: () => Date.now(),
    newId: (kind) => generateId(kind),
  })
  if (plan.fellBackCount > 0)
    ctx.log.warn('classifier.window_head_fallback', { count: plan.fellBackCount })
  if (plan.unresolvedRefs.length > 0)
    ctx.log.warn('classifier.unresolved_refs', { refs: plan.unresolvedRefs })

  for (const write of plan.planned) {
    yield { type: 'delta_emitted', action: write.action, entryId: write.entryId }
  }

  const next = nextStatusOnSuccess(status, { coversThrough: window.coversThrough, at: Date.now() })
  // writeStatus persists the lifecycle keys only; next.processedThrough is not
  // one of them — the watermark lands below, key-scoped and MAX-guarded in SQL.
  await writeStatus(ctx, next)
  await advanceWatermark(ctx, window.coversThrough)
  return { status: 'completed' }
}

export function ensurePeriodicClassifierPipelineRegistered(): void {
  try {
    getPipeline(PERIODIC_CLASSIFIER_KIND)
  } catch {
    definePipeline({
      kind: PERIODIC_CLASSIFIER_KIND,
      phases: [
        {
          name: 'classify',
          run: periodicClassifierPhase,
          resolves: PERIODIC_CLASSIFIER_RESOLVES,
        },
      ],
      affordance: 'pill-only',
      onPreflightFailure: async (ctx, error) => {
        const detail = error.kind === 'config-resolver' ? error.failure : error.detail
        const { status } = nextStatusOnFailure(await readStatus(ctx), {
          error: `classifier: ${detail}`,
          at: Date.now(),
        })
        await writeStatus(ctx, status)
      },
      gateBehavior: 'no-gate',
      concurrencyPolicy: { blockedBy: [PERIODIC_CLASSIFIER_KIND, 'chapter-close'] },
    })
  }
}
