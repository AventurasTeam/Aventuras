import { eq, sql } from 'drizzle-orm'

import { generateStructured } from '@/lib/ai'
import {
  buildClassifierActions,
  buildClassifierWindow,
  classifierExtractionSchema,
  idleStatus,
  nextStatusOnFailure,
  nextStatusOnSuccess,
  PERIODIC_CLASSIFIER_KIND,
  reconcileNewCharacter,
  type EmbedDescriptions,
  type ReconcileDecision,
} from '@/lib/classifier'
import { branches, type ClassifierStatus } from '@/lib/db'
import { generateId, IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import {
  appSettingsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  happeningsStore,
} from '@/lib/stores'

import { buildClassifierContext } from './classifier-context'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, ResolverInput } from '../types'

export { PERIODIC_CLASSIFIER_KIND }

export const PERIODIC_CLASSIFIER_RESOLVES: readonly ResolverInput[] = [{ target: 'classifier' }]

// Injected so tests drive the similarity bands deterministically and so the
// embedder composition (config + provider resolution) stays in the action layer.
let embedDescriptions: EmbedDescriptions = async () => ({ vectors: [], dim: 0 })
export function configureClassifierEmbedder(fn: EmbedDescriptions): void {
  embedDescriptions = fn
}

const PLACEHOLDER_FIELDS = ['ref', 'subject', 'object'] as const

// The generic substituteIds walker maps UUID -> placeholder, so the return trip
// needs its own pass. Unknown strings pass through untouched (a model-invented
// handle, or a newCharacters temp handle), which is what lets the planner
// resolve temp handles itself and report the rest as unresolved.
function substitutePlaceholders<T>(value: T, idMap: IdBiMap): T {
  if (Array.isArray(value)) return value.map((v) => substitutePlaceholders(v, idMap)) as T
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      if (typeof v === 'string' && (PLACEHOLDER_FIELDS as readonly string[]).includes(key)) {
        return [key, idMap.getUuidFor(v) ?? v]
      }
      return [key, substitutePlaceholders(v, idMap)]
    }),
  ) as T
}

async function readStatus(ctx: PhaseContext): Promise<ClassifierStatus> {
  const [row] = await ctx.db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, ctx.branchId))
  return row?.classifierStatus ?? idleStatus()
}

async function writeStatus(ctx: PhaseContext, status: ClassifierStatus): Promise<void> {
  // branches is not delta-logged (classifier.md -> Persistence): operational
  // state outside the reversal log, so a direct row write, not an action.
  //
  // Key-scoped json_set, never a whole-blob write: the reversal clamp
  // (classifierWatermarkClampOps) owns $.processedThrough and can commit between
  // this run's status read and this write, so serializing a snapshot of the whole
  // blob here would revert the clamp. Same per-field discipline as
  // cadence.md -> Concurrency.
  await ctx.db.run(
    sql`UPDATE ${branches} SET classifier_status = json_set(
          COALESCE(classifier_status, '{}'),
          '$.state', ${status.state},
          '$.lastSuccessAt', ${status.lastSuccessAt},
          '$.lastError', ${status.lastError},
          '$.retryCount', ${status.retryCount}
        ) WHERE ${branches.id} = ${ctx.branchId}`,
  )
}

// Advancing the watermark is its own key-scoped write, for the same reason in
// reverse: it must not carry this run's snapshot of the lifecycle keys.
async function advanceWatermark(ctx: PhaseContext, coversThrough: number): Promise<void> {
  await ctx.db.run(
    sql`UPDATE ${branches} SET classifier_status = json_set(
          COALESCE(classifier_status, '{}'), '$.processedThrough',
          MAX(COALESCE(json_extract(classifier_status, '$.processedThrough'), 0), ${coversThrough})
        ) WHERE ${branches.id} = ${ctx.branchId}`,
  )
}

export async function* periodicClassifierPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== ctx.branchId)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'periodic-classifier: no open story for branch' },
    }
  if (entriesStore.getLoadedBranch() !== ctx.branchId)
    return {
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: 'periodic-classifier: entries store loaded for another branch',
      },
    }

  const cfg = appSettingsStore.getAppSettings()
  const status = await readStatus(ctx)
  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === ctx.branchId)
    .sort((a, b) => a.position - b.position)
  const window = buildClassifierWindow({
    entries,
    processedThrough: status.processedThrough,
    maxEntries: cfg.classifierWindowMaxEntries,
  })
  if (window.isEmpty) return { status: 'completed' }

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

  const result = await generateStructured(
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
    ctx.abortSignal,
  )
  if (result.status === 'aborted') return { status: 'aborted' }
  if (result.status !== 'ok') {
    const { status: next } = nextStatusOnFailure(status, {
      error: result.status === 'not-configured' ? result.kind : result.detail,
      at: Date.now(),
    })
    await writeStatus(ctx, next)
    return {
      status: 'failed',
      error: { kind: 'provider', reason: 'unknown', detail: `classifier: ${result.status}` },
    }
  }

  // --- abort-free critical section starts here -------------------------------
  // From this point the burst ignores signal.aborted: a reversal's 'cancel'
  // either discarded a not-yet-committed run above, or lets this burst land for
  // the positional sweep to reverse. Never return aborted holding deltas.
  const extraction = result.value
  const substituted = substitutePlaceholders(extraction, idMap)

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
      gateBehavior: 'no-gate',
      concurrencyPolicy: { blockedBy: [PERIODIC_CLASSIFIER_KIND, 'chapter-close'] },
    })
  }
}
