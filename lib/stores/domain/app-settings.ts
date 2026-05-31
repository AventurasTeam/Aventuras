import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  APP_SETTINGS_DEFAULTS,
  type AppSettingsConfig,
  type AppSettingsDiagnostics,
  appSettingsConfigSchema,
  appSettingsDiagnosticsSchema,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'

type AppSettingsSnapshot = AppSettingsConfig & { diagnostics: AppSettingsDiagnostics }

type AppSettingsState = AppSettingsSnapshot & {
  apply: (snapshot: AppSettingsSnapshot) => void
  __reset: () => void
}

const DEFAULT_SNAPSHOT: AppSettingsSnapshot = {
  providers: APP_SETTINGS_DEFAULTS.providers,
  profiles: APP_SETTINGS_DEFAULTS.profiles,
  assignments: APP_SETTINGS_DEFAULTS.assignments,
  defaultProviderId: APP_SETTINGS_DEFAULTS.defaultProviderId,
  diagnostics: APP_SETTINGS_DEFAULTS.diagnostics,
}

const appSettingsStore = createStore<AppSettingsState>()((set) => ({
  ...DEFAULT_SNAPSHOT,
  apply: (snapshot) => set(snapshot),
  __reset: () => set(DEFAULT_SNAPSHOT),
}))

function useAppSettings<T>(selector: (s: AppSettingsSnapshot) => T): T {
  return useStore(appSettingsStore, selector as (s: AppSettingsState) => T)
}

function getAppSettings(): AppSettingsSnapshot {
  const s = appSettingsStore.getState()
  return {
    providers: s.providers,
    profiles: s.profiles,
    assignments: s.assignments,
    defaultProviderId: s.defaultProviderId,
    diagnostics: s.diagnostics,
  }
}

export type BootHydrateResult = { status: 'ok' } | { status: 'config-corrupt'; error: string }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// A read throw (unparseable JSON column) is treated as config corruption, not a
// transient miss — halting at the recovery screen beats silently defaulting away
// providers/keys. `read` is injected so the core is sqlite-free under test.
export async function hydrateAppSettings(read: () => Promise<unknown>): Promise<BootHydrateResult> {
  let raw: unknown
  try {
    raw = await read()
  } catch (err) {
    const message = messageOf(err)
    logger.error('bootstrap.app_settings_hydrate_failed', { error: message })
    return { status: 'config-corrupt', error: message }
  }

  if (raw === undefined) {
    appSettingsStore.getState().apply(DEFAULT_SNAPSHOT)
    return { status: 'ok' }
  }

  let config: AppSettingsConfig
  try {
    config = appSettingsConfigSchema.parse(raw)
  } catch (err) {
    const message = messageOf(err)
    logger.error('bootstrap.app_settings_hydrate_failed', { error: message })
    return { status: 'config-corrupt', error: message }
  }

  const diag = appSettingsDiagnosticsSchema.safeParse(
    (raw as { diagnostics?: unknown }).diagnostics,
  )
  if (!diag.success) {
    logger.error('bootstrap.app_settings_hydrate_failed', {
      error: `diagnostics: ${diag.error.message}`,
    })
  }
  const diagnostics = diag.success ? diag.data : APP_SETTINGS_DEFAULTS.diagnostics

  appSettingsStore.getState().apply({ ...config, diagnostics })
  return { status: 'ok' }
}

export const appSettings = {
  useAppSettings,
  getAppSettings,
  __reset: appSettingsStore.getState().__reset,
}

export { appSettingsStore }
export type { AppSettingsSnapshot, AppSettingsState }
