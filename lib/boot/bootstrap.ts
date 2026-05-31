import type { DbCtx } from '@/lib/actions'
import { configureDiagnosticsGate, logger } from '@/lib/diagnostics'
import { recoverInFlightRuns } from '@/lib/pipeline'
import {
  type BootHydrateResult,
  domain,
  hydrateAppSettings,
  readAppSettingsRow,
} from '@/lib/stores'

// __DEV__ force-on folds into isEnabled so dev captures the recovery pass; both
// thunks read app_settings.diagnostics LIVE and must never capture the snapshot.
export function ensureDiagnosticsGate(): void {
  configureDiagnosticsGate({
    isEnabled: () =>
      (typeof __DEV__ !== 'undefined' && __DEV__) || domain.getAppSettings().diagnostics.enabled,
    isDebugEnabled: () => domain.getAppSettings().diagnostics.debug_level_enabled,
  })
}

export async function runBootstrap(ctx: DbCtx): Promise<BootHydrateResult> {
  ensureDiagnosticsGate()
  // Recovery must never block boot: a failure of the orphan pass itself (not just
  // a per-orphan delta) is logged and boot proceeds to hydrate.
  try {
    await recoverInFlightRuns(ctx)
  } catch (err) {
    logger.error('bootstrap.recovery_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return hydrateAppSettings(() => readAppSettingsRow(ctx.db))
}
