import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { APP_SETTINGS_DEFAULTS, type AppSettingsConfig, appSettingsConfigSchema } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

// In-memory mirror of the app_settings singleton's config fields. The shape is
// the Zod-inferred config type; hydrateAppSettings validates the raw row against
// appSettingsConfigSchema, since the drizzle column $type is an unchecked cast.
type AppSettingsSnapshot = AppSettingsConfig

type AppSettingsState = AppSettingsSnapshot & {
  apply: (snapshot: AppSettingsSnapshot) => void
  __reset: () => void
}

const DEFAULT_SNAPSHOT: AppSettingsSnapshot = {
  providers: APP_SETTINGS_DEFAULTS.providers,
  profiles: APP_SETTINGS_DEFAULTS.profiles,
  assignments: APP_SETTINGS_DEFAULTS.assignments,
  defaultProviderId: APP_SETTINGS_DEFAULTS.defaultProviderId,
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
  }
}

// Injected-read core: testable without sqlite — the boot wrapper supplies the
// raw singleton row. appSettingsConfigSchema.parse is the runtime validation
// boundary (the drizzle $type is an unchecked cast) and strips the id /
// diagnostics columns. On a missing row, or a read / parse failure, apply
// defaults so boot continues; the blocking recovery screen lands with the
// provider-management slice that introduces real writes.
export async function hydrateAppSettings(read: () => Promise<unknown>): Promise<void> {
  try {
    const raw = await read()
    const snapshot = raw === undefined ? DEFAULT_SNAPSHOT : appSettingsConfigSchema.parse(raw)
    appSettingsStore.getState().apply(snapshot)
  } catch (err) {
    logger.error('bootstrap.app_settings_hydrate_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    appSettingsStore.getState().apply(DEFAULT_SNAPSHOT)
  }
}

export const appSettings = {
  useAppSettings,
  getAppSettings,
  __reset: appSettingsStore.getState().__reset,
}

export { appSettingsStore }
export type { AppSettingsSnapshot, AppSettingsState }
