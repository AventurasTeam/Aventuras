import {
  applyDeltaAction,
  describeDeltaReplayError,
  holdBranchWriteExclusive,
  normalizeAppSettingsRow,
  readHeldClassifierStoryIds,
  registerAllDomains,
  releaseBranchWriteExclusive,
  resetStuckClassifierRunState,
  reverseReplayDeltas,
  settleUserWrites,
} from '@/lib/actions'
import type { DbCtx } from '@/lib/db'
import { configureDiagnosticsGate, logger } from '@/lib/diagnostics'
import {
  buildDrainController,
  embedClassifierDescriptions,
  setDrainKickSink,
} from '@/lib/embedder-swap'
import {
  configureClassifierEmbedder,
  configureDeltaActionPort,
  ensurePeriodicClassifierPipelineRegistered,
  pipelineEventBus,
  recoverInFlightRuns,
  type RecoveryReport,
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
    describeReplayError: describeDeltaReplayError,
    settleUserWrites,
    holdBranchWriteExclusive,
    releaseBranchWriteExclusive,
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

export async function runBootstrap(ctx: DbCtx): Promise<BootHydrateResult> {
  // Registry must be populated before recovery drives reverse-replay (resolves by target_table).
  registerAllDomains()
  ensureDiagnosticsGate()
  ensureDeltaActionPort()
  wireDrainWorker(ctx)
  configureClassifierEmbedder(embedClassifierDescriptions)
  // per-turn's chain names the pass at a turn's commit; an unregistered kind chains nothing.
  ensurePeriodicClassifierPipelineRegistered()
  // Recovery must never block boot: a failure of the orphan pass itself (not just
  // a per-orphan delta) is logged and boot proceeds to hydrate.
  let recovery: RecoveryReport | null = null
  try {
    recovery = await recoverInFlightRuns(ctx)
  } catch (err) {
    logger.error('bootstrap.recovery_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  // A branch's own orphan: state: 'running' outlived the process that wrote it.
  // Separate from recoverInFlightRuns (pipeline_runs markers) because
  // classifier_status is a branches column with no marker row of its own — and
  // unlike a marker's deltas, there is nothing here to reverse-replay. Ordered
  // after recovery because which branches are reconcilable depends on which
  // orphans reversed; with no report at all, none of them are.
  if (recovery !== null) {
    try {
      await resetStuckClassifierRunState(ctx, recovery.failures)
    } catch (err) {
      logger.error('bootstrap.classifier_running_reset_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Read, not inferred from the failures: a reset that freed a branch, or one that threw or never
  // ran, would otherwise make the copy promise a hold that isn't there or miss one that is.
  let heldStoryIds: string[] | null = null
  try {
    heldStoryIds = await readHeldClassifierStoryIds(ctx)
  } catch (err) {
    logger.error('bootstrap.classifier_hold_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  recoveryReportStore.publish({
    reversed: recovery?.reversed ?? [],
    failures: recovery?.failures ?? [],
    heldStoryIds,
  })
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
