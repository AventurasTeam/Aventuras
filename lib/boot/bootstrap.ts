import {
  DeltaReplayError,
  applyDeltaAction,
  buildDrainController,
  embedClassifierDescriptions,
  headPosition,
  normalizeAppSettingsRow,
  readClassifierStatus,
  registerAllDomains,
  resetStuckClassifierRunState,
  reverseReplayDeltas,
  runClassifierNow,
  setDrainKickSink,
} from '@/lib/actions'
import { createClassifierScheduler } from '@/lib/classifier'
import type { DbCtx } from '@/lib/db'
import { configureDiagnosticsGate, logger } from '@/lib/diagnostics'
import {
  configureClassifierEmbedder,
  configureDeltaActionPort,
  PER_TURN_KIND,
  pipelineEventBus,
  recoverInFlightRuns,
} from '@/lib/pipeline'
import {
  appSettingsStore,
  type BootHydrateResult,
  currentStoryStore,
  generationStore,
  recoveryReportStore,
  rehydrateAppSettings,
} from '@/lib/stores'

// __DEV__ force-on folds into isEnabled so dev captures the recovery pass; both
// thunks read app_settings.diagnostics LIVE and must never capture the snapshot.
export function ensureDiagnosticsGate(): void {
  configureDiagnosticsGate({
    isEnabled: () =>
      (typeof __DEV__ !== 'undefined' && __DEV__) ||
      appSettingsStore.getAppSettings().diagnostics.enabled,
    isDebugEnabled: () => appSettingsStore.getAppSettings().diagnostics.debug_level_enabled,
  })
}

// lib/pipeline can't import @/lib/actions directly (require cycle through
// submit-turn.ts), so the real delta-action functions are wired in here.
export function ensureDeltaActionPort(): void {
  configureDeltaActionPort({
    applyDeltaAction,
    reverseReplayDeltas,
    describeReplayError: (e) => (e instanceof DeltaReplayError ? String(e.cause) : undefined),
  })
}

let teardownDrainWorker: (() => void) | null = null

// The opportunistic stale-row drain worker: warm-cache only, so it reports
// nothing to the user (the blocking pre-retrieval sync stage owns correctness).
// Idempotent across boot re-runs — tears the prior wiring down first so a
// re-mount cannot leak a second subscription.
export function wireDrainWorker(ctx: DbCtx): void {
  teardownDrainWorker?.()
  const controller = buildDrainController(ctx)
  setDrainKickSink(controller.kick)
  const unsubscribe = pipelineEventBus.subscribe('run_complete', () => {
    const open = currentStoryStore.getCurrentStory()
    // A chained successor keeps hasActiveRun true; only drain when fully idle so
    // the worker can never overlap a pipeline run's own sync stage at start.
    if (open != null && !generationStore.hasActiveRun()) controller.noteIdle(open.storyId)
  })
  teardownDrainWorker = () => {
    unsubscribe()
    controller.stop()
    setDrainKickSink(null)
    teardownDrainWorker = null
  }
}

let teardownClassifierScheduler: (() => void) | null = null

// Cadence tick for the periodic classifier. run_complete is the moment the
// unprocessed count changes; idempotent across boot re-runs like the drain.
export function wireClassifierScheduler(ctx: DbCtx): void {
  teardownClassifierScheduler?.()
  configureClassifierEmbedder(embedClassifierDescriptions)
  const scheduler = createClassifierScheduler({
    cadenceFor: () => currentStoryStore.getCurrentStory()?.settings.classifierCadence ?? 8,
    headPositionFor: (branchId) => headPosition(branchId, ctx),
    statusFor: (branchId) => readClassifierStatus(branchId, ctx),
    startRun: (branchId) => runClassifierNow(branchId, ctx),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })
  const unsubscribe = pipelineEventBus.subscribe('run_complete', (event) => {
    // Only a foreground turn changes the count; the classifier's own completion
    // must not re-trigger it.
    if (event.kind !== PER_TURN_KIND || event.outcome !== 'completed') return
    const open = currentStoryStore.getCurrentStory()
    if (open != null) void scheduler.noteTurnCommitted(open.branchId)
  })
  teardownClassifierScheduler = () => {
    unsubscribe()
    scheduler.stop()
    teardownClassifierScheduler = null
  }
}

export async function runBootstrap(ctx: DbCtx): Promise<BootHydrateResult> {
  // Registry must be populated before recovery drives reverse-replay (resolves by target_table).
  registerAllDomains()
  ensureDiagnosticsGate()
  ensureDeltaActionPort()
  wireDrainWorker(ctx)
  wireClassifierScheduler(ctx)
  // Recovery must never block boot: a failure of the orphan pass itself (not just
  // a per-orphan delta) is logged and boot proceeds to hydrate.
  try {
    const report = await recoverInFlightRuns(ctx)
    if (report.reversed.length > 0) recoveryReportStore.publish(report)
  } catch (err) {
    logger.error('bootstrap.recovery_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  // A branch's own orphan: state: 'running' outlived the process that wrote it.
  // Separate from recoverInFlightRuns (pipeline_runs markers) because
  // classifier_status is a branches column with no marker row of its own — and
  // unlike a marker's deltas, there is nothing here to reverse-replay.
  try {
    await resetStuckClassifierRunState(ctx)
  } catch (err) {
    logger.error('bootstrap.classifier_running_reset_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  // ctx.db (not the module-level default) so recovery and hydrate hit the
  // same instance.
  const result = await rehydrateAppSettings(ctx.db)
  // Materialize schema-added defaults into the row (the DB is the settings
  // editing surface until M7). Gated on a clean hydrate — a corrupt row must
  // stay inspectable — and a failure here never blocks boot.
  if (result.status === 'ok') {
    try {
      const normalized = await normalizeAppSettingsRow(ctx)
      if (normalized.status === 'normalized')
        logger.debug('bootstrap.app_settings_normalized', { columns: normalized.columns })
    } catch (err) {
      logger.error('bootstrap.app_settings_normalize_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}
