import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm'

import { boundedSignal } from '@/lib/abort'
import { generateStructured } from '@/lib/ai'
import {
  buildClassifierActions,
  buildClassifierWindow,
  classifierReplySchema,
  clampEmbeddedCharacter,
  IDLE_STATUS_JSON,
  idleStatus,
  nextStatusOnFailure,
  nextStatusOnStart,
  nextStatusOnSuccess,
  newPlacesOf,
  PERIODIC_CLASSIFIER_KIND,
  reconcileNewCharacter,
  substituteClassifierIds,
  type ReconcileDecision,
} from '@/lib/classifier'
import {
  branches,
  storyEntries,
  type ClassifierStatus,
  type Entity,
  type StoryEntry,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId, IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import {
  appSettingsStore,
  characterRelationshipsStore,
  currentStoryStore,
  entitiesStore,
  happeningsStore,
} from '@/lib/stores'

import { buildClassifierContext } from './classifier-context'
import { classifierEmbedder } from './description-embedder'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import { enterWritePhase } from '../runtime/write-phase'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, ResolverInput } from '../types'

export { PERIODIC_CLASSIFIER_KIND }

export const PERIODIC_CLASSIFIER_RESOLVES: readonly ResolverInput[] = [{ target: 'classifier' }]

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

// Direct row writes: branches isn't delta-logged (classifier.md -> Persistence). Key-scoped
// json_set: the reversal clamp owns $.processedThrough and can commit between read and write.
async function patchStatus(ctx: StatusCtx, keys: SQL): Promise<void> {
  await ctx.db.run(
    sql`UPDATE ${branches} SET classifier_status = json_set(
          COALESCE(classifier_status, ${IDLE_STATUS_JSON}), ${keys}
        ) WHERE ${branches.id} = ${ctx.branchId}`,
  )
}

function lifecycleKeys(status: ClassifierStatus): SQL {
  return sql`'$.state', ${status.state}, '$.lastSuccessAt', ${status.lastSuccessAt},
      '$.lastError', ${status.lastError}, '$.retryCount', ${status.retryCount}`
}

// MAX-guarded, and never from this run's snapshot of the lifecycle keys.
function watermarkKey(coversThrough: number): SQL {
  return sql`'$.processedThrough',
      MAX(COALESCE(json_extract(classifier_status, '$.processedThrough'), 0), ${coversThrough})`
}

function writeStatus(ctx: StatusCtx, status: ClassifierStatus): Promise<void> {
  return patchStatus(ctx, lifecycleKeys(status))
}

function advanceWatermark(ctx: StatusCtx, coversThrough: number): Promise<void> {
  return patchStatus(ctx, watermarkKey(coversThrough))
}

// The entity stores are global, hydrated for one branch: a switch away mid-pass leaves them on
// another, and filtering them by ours would reconcile and plan against an empty roster.
function storesHoldBranch(ctx: Pick<PhaseContext, 'storyId' | 'branchId'>): boolean {
  const open = currentStoryStore.getCurrentStory()
  return (
    open?.branchId === ctx.branchId &&
    open.storyId === ctx.storyId &&
    entitiesStore.getLoadedBranch() === ctx.branchId
  )
}

function branchEntities(branchId: string): Entity[] {
  return [...entitiesStore.getEntities().values()].filter((e) => e.branchId === branchId)
}

async function recordFailure(ctx: StatusCtx, detail: string): Promise<void> {
  const { status } = nextStatusOnFailure(await readStatus(ctx), { error: detail, at: Date.now() })
  await writeStatus(ctx, status)
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

  const entities = branchEntities(ctx.branchId)
  const relationships = [...characterRelationshipsStore.getRelationshipRows().values()].filter(
    (r) => r.branchId === ctx.branchId,
  )
  // classifier.md → Mentioned places: read once, so prompt and reply schema agree.
  const mentionedPlaces = open.settings.classifierMentionedPlaces
  const idMap = new IdBiMap()
  const prompt = renderTemplate(
    TEMPLATE_IDS.periodicClassifier,
    buildClassifierContext({
      window,
      entities,
      happenings: [...happeningsStore.getHappenings().values()].filter(
        (h) => h.branchId === ctx.branchId,
      ),
      relationships,
      mentionedPlaces,
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
      classifierReplySchema(mentionedPlaces),
      {
        providers: cfg.providers,
        profiles: cfg.profiles,
        assignments: cfg.assignments,
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

  const extraction = result.value
  const substituted = substituteClassifierIds(
    extraction,
    idMap,
    new Set([
      ...extraction.newCharacters.map((c) => c.handle),
      ...newPlacesOf(extraction).map((p) => p.handle),
    ]),
  )

  // Nothing is committed before the hold, so a discard only restores the pre-run status, as
  // the abort arm above does: no retry is burned and the watermark stays.
  const discard = async (reason: string | null): Promise<PhaseResult> => {
    if (reason !== null) ctx.log.warn('classifier.pass_discarded', { reason })
    await writeStatus(ctx, status)
    return { status: 'aborted' }
  }

  if (!storesHoldBranch(ctx)) return discard('branch-unloaded')
  // Re-read after the model call: World edits run under a no-gate pass, so the prompt's
  // snapshot misses a character the user created mid-call and still holds one deleted.
  const current = branchEntities(ctx.branchId)
  const embedDescriptions = classifierEmbedder()
  const decisions = new Map<string, ReconcileDecision>()
  for (const candidate of substituted.newCharacters) {
    if (ctx.abortSignal.aborted) return discard(null)
    // Reconcile the clamped row, not the raw reply: plan.ts bounds both embedded
    // fields, so a key built from an unbounded one measures text no row holds.
    const stored = clampEmbeddedCharacter(candidate)
    // The planner drops a blank name, yet its keywords can still name a row: reconciling
    // it would spend an embed call on a decision nothing reads.
    if (stored.name === '') continue
    decisions.set(
      candidate.handle,
      await reconcileNewCharacter(
        { ...stored, keywords: candidate.keywords },
        { entities: current, embedDescriptions, scene: window.sceneOf(candidate.sourceTurn) },
      ),
    )
  }

  // generation-pipeline.md → No-gate write phase.
  if (!(await enterWritePhase(ctx))) return discard(null)

  // Abort-free under the write lock: a reversal's cancel lets this burst land for the positional
  // sweep to reverse. Never return aborted holding deltas; the discards below hold none.
  if (!storesHoldBranch(ctx)) return discard('branch-unloaded')
  // classifier.md → Mentioned places: planned inside the hold, against the rows as they stand,
  // so a place a turn created during the model call is reused rather than made again.
  const plan = buildClassifierActions(substituted, {
    branchId: ctx.branchId,
    window,
    entities: branchEntities(ctx.branchId),
    decisions,
    now: () => Date.now(),
    newId: (kind) => generateId(kind),
  })
  if (plan.fellBackCount > 0)
    ctx.log.warn('classifier.window_head_fallback', { count: plan.fellBackCount })
  if (plan.unresolvedRefs.length > 0)
    ctx.log.warn('classifier.unresolved_refs', { refs: plan.unresolvedRefs })
  // The per-turn writer's keys (per-turn-creates.ts).
  for (const drop of plan.droppedPlaces)
    ctx.log.warn('classifier.create_dropped', { kind: 'location', ...drop })
  for (const drop of plan.parentDrops) ctx.log.warn('classifier.create_parent_dropped', drop)

  for (const write of plan.planned) {
    yield { type: 'delta_emitted', action: write.action, entryId: write.entryId }
  }

  const next = nextStatusOnSuccess(status, { coversThrough: window.coversThrough, at: Date.now() })
  // One statement: a success recorded without its watermark would reset the retry count on a
  // pass that then fails and reverses, and retry it at the first backoff forever.
  await patchStatus(ctx, sql`${lifecycleKeys(next)}, ${watermarkKey(window.coversThrough)}`)
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
        await recordFailure(ctx, `classifier: ${detail}`)
      },
      // A rejected write throws past the phase (orchestrator.ts runPhases) rather than
      // returning `{ status: 'failed' }`, so this hook is what persists the failure.
      onPhaseException: async (ctx, error) => {
        const detail = `classifier: ${error.detail}`
        try {
          await recordFailure(ctx, detail)
        } catch (e) {
          // A failed attempt lands nothing; unrecorded, the branch stays running until boot.
          logger.warn('classifier.failure_record_retried', {
            branchId: ctx.branchId,
            error: e instanceof Error ? e.message : String(e),
          })
          await recordFailure(ctx, detail)
        }
      },
      gateBehavior: 'no-gate',
      concurrencyPolicy: { blockedBy: [PERIODIC_CLASSIFIER_KIND, 'chapter-close'] },
    })
  }
}
