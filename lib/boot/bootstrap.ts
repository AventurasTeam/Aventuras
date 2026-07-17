import {
  DeltaReplayError,
  applyDeltaAction,
  registerAllDomains,
  reverseReplayDeltas,
} from '@/lib/actions'
import type { DbCtx } from '@/lib/db'
import { configureDiagnosticsGate, logger } from '@/lib/diagnostics'
import { configureDeltaActionPort, recoverInFlightRuns } from '@/lib/pipeline'
import {
  appSettingsStore,
  type BootHydrateResult,
  hydrateAppSettings,
  readAppSettingsRow,
  recoveryReportStore,
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
// turns/pipeline.ts), so the real delta-action functions are wired in here.
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
  return hydrateAppSettings(() => readAppSettingsRow(ctx.db))
}
