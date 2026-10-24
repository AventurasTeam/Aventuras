import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm'

import { boundedSignal } from '@/lib/abort'
import {
  generateStructured,
  profileTimeoutMs,
  resolveModel,
  type GenerateStructuredResult,
  type ResolveModelConfig,
} from '@/lib/ai'
import {
  buildClassifierActions,
  buildClassifierWindow,
  classifierReplySchema,
  clampEmbeddedCharacter,
  IDLE_STATUS_JSON,
  nextStatusOnFailure,
  nextStatusOnStart,
  nextStatusOnSuccess,
  newPlacesOf,
  PERIODIC_CLASSIFIER_KIND,
  readClassifierReply,
  RECONCILED_KINDS,
  reconcileNewEntity,
  substituteClassifierIds,
  type PlanResult,
  type ReconciledKind,
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
  happeningAwarenessStore,
  happeningsStore,
  threadsStore,
  type OpenStory,
} from '@/lib/stores'

import { buildClassifierContext } from './classifier-context'
import { classifierEmbedder } from './description-embedder'
import { readClassifierStatus } from './memory-chain'
import { PER_TURN_KIND } from './per-turn'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import { toPipelineError } from '../call-error'
import type {
  PhaseContext,
  PhaseEmittedEvent,
  PhaseResult,
  PipelineError,
  ResolverInput,
} from '../types'

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

/** classifier.md → Failure policy: the bound when the classifier profile sets no timeout. */
export const PASS_TIMEOUT_DEFAULT_MS = 600_000

const CLASSIFY_PHASE = 'classify'

/** The classifier profile's `timeout` over the whole structured call, retries included. */
export function passTimeoutMs(config: ResolveModelConfig): number {
  const resolved = resolveModel('classifier', config)
  // A story override resolves to no profile params.
  return (
    profileTimeoutMs(resolved.ok ? resolved.params.timeout : undefined) ?? PASS_TIMEOUT_DEFAULT_MS
  )
}

type CallFailure = Exclude<GenerateStructuredResult<unknown>, { status: 'ok' }>

// `lastError` keeps the bare cause for the status block; the run's error is what the reader shows.
function passFailure(
  result: CallFailure,
  timeoutMs: number,
): { lastError: string; error: PipelineError } {
  switch (result.status) {
    // Only an expiry reaches here: a cancel has already returned `aborted`.
    case 'aborted':
      return {
        lastError: `timeout after ${timeoutMs}ms`,
        error: {
          kind: 'provider',
          reason: 'timeout',
          detail: `classifier: timeout after ${timeoutMs}ms`,
        },
      }
    // A config fault, so the reader's entry can offer its fix.
    case 'not-configured':
      return {
        lastError: result.kind,
        error: {
          kind: 'config-resolver',
          failure: result.kind,
          target: 'classifier',
          phaseName: CLASSIFY_PHASE,
        },
      }
    case 'failed':
      return {
        lastError: result.detail,
        error: { kind: 'provider', reason: 'unknown', detail: `classifier: ${result.detail}` },
      }
  }
}

// The per-turn writer's keys for a cut condition and visual value (per-turn-creates.ts, apply.ts).
const CUT_KEYS = {
  condition: 'classifier.condition_truncated',
  visual: 'classifier.visual_truncated',
  standing: 'classifier.standing_truncated',
} as const satisfies Record<PlanResult['cutTexts'][number]['kind'], string>

type StatusCtx = Pick<PhaseContext, 'db' | 'branchId'>

// The status the run found, for onInterrupt to restore once the orchestrator's reversal commits.
const PRE_RUN_STATUS = 'periodicClassifier.preRunStatus'

function readStatus(ctx: StatusCtx): Promise<ClassifierStatus> {
  return readClassifierStatus(ctx.branchId, ctx)
}

// Direct row writes: branches isn't delta-logged (classifier.md -> Persistence). Key-scoped
// json_set (cadence.md -> Concurrency): the reversal clamp writes the column too, under no lock.
async function patchStatus(ctx: StatusCtx, keys: SQL): Promise<void> {
  await ctx.db.run(
    sql`UPDATE ${branches} SET classifier_status = json_set(
          COALESCE(classifier_status, ${IDLE_STATUS_JSON}), ${keys}
        ) WHERE ${branches.id} = ${ctx.branchId}`,
  )
}

function lifecycleKeys(status: ClassifierStatus): SQL {
  return sql`'$.state', ${status.state}, '$.lastSuccessAt', ${status.lastSuccessAt},
      '$.lastError', ${status.lastError}`
}

// MAX-guarded, and never from this run's snapshot of the lifecycle keys.
function watermarkKey(coversThrough: number): SQL {
  return sql`'$.processedThrough',
      MAX(COALESCE(json_extract(classifier_status, '$.processedThrough'), 0), ${coversThrough})`
}

function writeStatus(ctx: StatusCtx, status: ClassifierStatus): Promise<void> {
  return patchStatus(ctx, lifecycleKeys(status))
}

async function writeSuccess(
  ctx: StatusCtx,
  status: ClassifierStatus,
  coversThrough: number,
): Promise<void> {
  const next = nextStatusOnSuccess(status, { coversThrough, at: Date.now() })
  // One statement: the status never reports a success whose watermark didn't land.
  await patchStatus(ctx, sql`${lifecycleKeys(next)}, ${watermarkKey(coversThrough)}`)
}

function advanceWatermark(ctx: StatusCtx, coversThrough: number): Promise<void> {
  return patchStatus(ctx, watermarkKey(coversThrough))
}

// The entity stores hold one branch: filtered for a branch they don't hold, they leave an empty
// roster to prompt, reconcile and plan against.
function storesHoldBranch(
  open: OpenStory | null,
  ctx: Pick<PhaseContext, 'storyId' | 'branchId'>,
): open is OpenStory {
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
  const status = nextStatusOnFailure(await readStatus(ctx), { error: detail, at: Date.now() })
  await writeStatus(ctx, status)
}

export async function* periodicClassifierPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const open = currentStoryStore.getCurrentStory()
  if (!storesHoldBranch(open, ctx))
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'periodic-classifier: branch not loaded' },
    }
  const cfg = appSettingsStore.getAppSettings()
  const status = await readStatus(ctx)
  ctx.intermediates[PRE_RUN_STATUS] = status
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
    // Only a truncated window of system rows advances the watermark, and never onto the tail's
    // (writeSystemEntry keeps one system row, at the tail). Untruncated, the cadence counts none.
    // A completed pass over nothing still clears a failure it was owed for.
    if (status.state !== 'idle') await writeSuccess(ctx, status, window.coversThrough)
    else if (window.coversThrough > (status.processedThrough ?? 0))
      await advanceWatermark(ctx, window.coversThrough)
    return { status: 'completed' }
  }

  // Prompt, reconcile and plan share this roster: under the gate nothing changes it mid-call.
  const entities = branchEntities(ctx.branchId)
  const relationships = [...characterRelationshipsStore.getRelationshipRows().values()].filter(
    (r) => r.branchId === ctx.branchId,
  )
  const threads = [...threadsStore.getThreads().values()].filter((t) => t.branchId === ctx.branchId)
  // classifier.md → Mentioned places: read once, so prompt and reply schema agree.
  const mentionedPlaces = open.settings.classifierMentionedPlaces
  const happenings = [...happeningsStore.getHappenings().values()].filter(
    (h) => h.branchId === ctx.branchId,
  )
  // The stored pairs a listed happening's awareness skips (plan.ts → knownAwareness).
  const awareness = [...happeningAwarenessStore.getAwareness().values()].filter(
    (a) => a.branchId === ctx.branchId,
  )
  const idMap = new IdBiMap()
  const prompt = renderTemplate(
    TEMPLATE_IDS.periodicClassifier,
    buildClassifierContext({
      window,
      entities,
      happenings,
      relationships,
      threads,
      mentionedPlaces,
      idMap,
    }),
  )

  const modelConfig: ResolveModelConfig = {
    providers: cfg.providers,
    profiles: cfg.profiles,
    assignments: cfg.assignments,
    storyModels: open.settings.models,
  }
  const timeoutMs = passTimeoutMs(modelConfig)

  // Read by the status block; left behind by a crash, it holds the branch until a boot clears it.
  await writeStatus(ctx, nextStatusOnStart(status))

  const bounded = boundedSignal(ctx.abortSignal, timeoutMs)
  let result
  try {
    result = await generateStructured(
      'classifier',
      prompt,
      classifierReplySchema(mentionedPlaces),
      modelConfig,
      bounded.signal,
    )
  } finally {
    bounded.dispose()
  }
  // generation-pipeline.md → Two retry tiers: one event per retried attempt, however the call ended.
  const retried = result.status === 'not-configured' ? [] : result.recoverable
  for (const attempt of retried)
    yield { type: 'recoverable_error', error: toPipelineError(attempt) }
  // An interrupt leaves the watermark; onInterrupt restores the pre-run status.
  if (result.status === 'aborted' && !bounded.expired()) return { status: 'aborted' }
  if (result.status !== 'ok') {
    // An expiry aborts the call as a cancel does, but it is a provider fault: it fails the pass,
    // leaving the watermark, so the next Send owes the pass (classifier.md → Failure policy).
    const failure = passFailure(result, timeoutMs)
    await writeStatus(
      ctx,
      nextStatusOnFailure(status, { error: failure.lastError, at: Date.now() }),
    )
    return { status: 'failed', error: failure.error }
  }

  const { reply: extraction, malformed } = readClassifierReply(result.value)
  for (const drop of malformed) ctx.log.warn('classifier.entry_malformed', drop)
  const substituted = substituteClassifierIds(
    extraction,
    idMap,
    new Set([
      ...extraction.newCharacters.map((c) => c.handle),
      ...extraction.newFactions.map((f) => f.handle),
      ...newPlacesOf(extraction).map((p) => p.handle),
    ]),
  )

  const deps = { entities, embedDescriptions: classifierEmbedder(), log: ctx.log }
  const reconcile = async (
    kind: ReconciledKind,
    // A handle a character already claimed plans nothing as a faction (plan.ts).
    claimed: ReadonlySet<string> = new Set(),
  ): Promise<Map<string, ReconcileDecision> | null> => {
    const decided = new Map<string, ReconcileDecision>()
    for (const candidate of substituted[RECONCILED_KINDS[kind].reply]) {
      if (ctx.abortSignal.aborted) return null
      // A repeated handle keeps its first declaration, as plan.ts keeps its first binding.
      if (decided.has(candidate.handle) || claimed.has(candidate.handle)) continue
      // Reconcile the clamped row, not the raw reply: plan.ts bounds both embedded
      // fields, so a key built from an unbounded one measures text no row holds.
      const stored = clampEmbeddedCharacter(candidate)
      // The planner drops a blank name, yet its keywords can still name a row: reconciling
      // it would spend an embed call on a decision nothing reads.
      if (stored.name === '') continue
      decided.set(
        candidate.handle,
        await reconcileNewEntity(
          { ...stored, keywords: candidate.keywords },
          kind === 'character'
            ? { ...deps, kind, scene: window.sceneOf(candidate.sourceTurn) }
            : { ...deps, kind },
        ),
      )
    }
    return decided
  }
  const decisions = await reconcile('character')
  if (decisions === null) return { status: 'aborted' }
  const factionDecisions = await reconcile('faction', new Set(decisions.keys()))
  if (factionDecisions === null) return { status: 'aborted' }

  const plan = buildClassifierActions(substituted, {
    branchId: ctx.branchId,
    window,
    entities,
    decisions,
    factionDecisions,
    now: () => Date.now(),
    newId: (kind) => generateId(kind),
    threads,
    happenings,
    awareness,
  })
  if (plan.fellBackCount > 0)
    ctx.log.warn('classifier.window_head_fallback', { count: plan.fellBackCount })
  if (plan.unresolvedRefs.length > 0)
    ctx.log.warn('classifier.unresolved_refs', { refs: plan.unresolvedRefs })
  for (const drop of plan.droppedMemberships) ctx.log.warn('classifier.membership_dropped', drop)
  for (const drop of plan.droppedStandings) ctx.log.warn('classifier.standing_dropped', drop)
  // The per-turn writer's keys (per-turn-creates.ts).
  for (const drop of plan.droppedPlaces)
    ctx.log.warn('classifier.create_dropped', { kind: 'location', ...drop })
  for (const drop of plan.parentDrops) ctx.log.warn('classifier.create_parent_dropped', drop)
  for (const clash of plan.renameClashes) ctx.log.warn('classifier.rename_clash', clash)
  for (const unseen of plan.unseenRefs) ctx.log.warn('classifier.unseen_ref', unseen)
  for (const drop of plan.droppedPlacements) ctx.log.warn('classifier.placement_dropped', drop)
  for (const icon of plan.unknownIcons) ctx.log.warn('classifier.icon_unknown', icon)
  for (const drop of plan.droppedRenames) ctx.log.warn('classifier.rename_dropped', drop)
  for (const drop of plan.droppedReturns) ctx.log.warn('classifier.return_dropped', drop)
  for (const drop of plan.droppedThreads)
    ctx.log.warn('classifier.create_dropped', { kind: 'thread', ...drop })
  for (const moved of plan.earlyCloses) ctx.log.warn('classifier.thread_close_moved', moved)
  for (const { kind, ...cut } of plan.cutTexts) ctx.log.warn(CUT_KEYS[kind], cut)

  // classifier.md → Pipeline framing: a pass cancelled during its writes reverses its own group.
  for (const write of plan.planned) {
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    yield { type: 'delta_emitted', action: write.action, entryId: write.entryId }
  }
  // The last point a cancel discards; past it the pass commits, watermark included.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }

  await writeSuccess(ctx, status, window.coversThrough)
  // The smoke's regex parses this line: keep its field names and order.
  ctx.log.debug('classifier.pass_completed', {
    parseRetries: retried.filter((e) => e.tier === 'parse').length,
    providerRetries: retried.filter((e) => e.tier === 'provider').length,
    writes: plan.planned.length,
  })
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
          name: CLASSIFY_PHASE,
          run: periodicClassifierPhase,
          resolves: PERIODIC_CLASSIFIER_RESOLVES,
        },
      ],
      affordance: 'pill-and-banner',
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
          logger.warn(
            'classifier.failure_record_retried',
            { branchId: ctx.branchId, error: e instanceof Error ? e.message : String(e) },
            { actionId: ctx.actionId },
          )
          await recordFailure(ctx, detail)
        }
      },
      // Not in the phase: a reversal that can't commit leaves `running` for boot recovery.
      onInterrupt: async (ctx) => {
        const status = ctx.intermediates[PRE_RUN_STATUS] as ClassifierStatus | undefined
        if (!status) return
        try {
          await writeStatus(ctx, status)
        } catch (e) {
          // Left running, the branch is held until a boot resets it.
          logger.warn(
            'classifier.interrupt_restore_retried',
            { branchId: ctx.branchId, error: e instanceof Error ? e.message : String(e) },
            { actionId: ctx.actionId },
          )
          await writeStatus(ctx, status)
        }
      },
      gateBehavior: 'hard-gate',
      interruptible: 'pass',
      concurrencyPolicy: {
        blockedBy: [PER_TURN_KIND, PERIODIC_CLASSIFIER_KIND, 'chapter-close', 'translation-retry'],
      },
    })
  }
}
