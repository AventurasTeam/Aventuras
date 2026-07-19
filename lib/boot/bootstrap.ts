import {
  DeltaReplayError,
  applyDeltaAction,
  normalizeAppSettingsRow,
  registerAllDomains,
  reverseReplayDeltas,
} from '@/lib/actions'
import type { DbCtx } from '@/lib/db'
import { configureDiagnosticsGate, logger } from '@/lib/diagnostics'
import { configureDeltaActionPort, recoverInFlightRuns } from '@/lib/pipeline'
import {
  appSettingsStore,
  type BootHydrateResult,
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

export async function runBootstrap(ctx: DbCtx): Promise<BootHydrateResult> {
  // Registry must be populated before recovery drives reverse-replay (resolves by target_table).
  registerAllDomains()
  ensureDiagnosticsGate()
  ensureDeltaActionPort()
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
