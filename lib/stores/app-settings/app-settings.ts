import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  APP_SETTINGS_DEFAULTS,
  type AppSettingsConfig,
  type AppSettingsDiagnostics,
  appSettingsConfigSchema,
  appSettingsDiagnosticsSchema,
} from '@/lib/db'
import { logger, setHttpCallKnownSecretValues } from '@/lib/diagnostics'

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
  embeddingModelId: APP_SETTINGS_DEFAULTS.embeddingModelId,
  embeddingProviderId: APP_SETTINGS_DEFAULTS.embeddingProviderId,
  defaultStorySettings: APP_SETTINGS_DEFAULTS.defaultStorySettings,
  defaultCalendarId: APP_SETTINGS_DEFAULTS.defaultCalendarId,
  defaultSuggestionCategories: APP_SETTINGS_DEFAULTS.defaultSuggestionCategories,
  appearance: APP_SETTINGS_DEFAULTS.appearance,
  uiLanguage: APP_SETTINGS_DEFAULTS.uiLanguage,
  onboardingCompletedAt: APP_SETTINGS_DEFAULTS.onboardingCompletedAt,
  diagnostics: APP_SETTINGS_DEFAULTS.diagnostics,
}

const store = createStore<AppSettingsState>()((set) => ({
  ...DEFAULT_SNAPSHOT,
  apply: (snapshot) => set(snapshot),
  __reset: () => set(DEFAULT_SNAPSHOT),
}))

function useAppSettings<T>(selector: (s: AppSettingsSnapshot) => T): T {
  return useStore(store, selector as (s: AppSettingsState) => T)
}

function getAppSettings(): AppSettingsSnapshot {
  const s = store.getState()
  return {
    providers: s.providers,
    profiles: s.profiles,
    assignments: s.assignments,
    defaultProviderId: s.defaultProviderId,
    embeddingModelId: s.embeddingModelId,
    embeddingProviderId: s.embeddingProviderId,
    defaultStorySettings: s.defaultStorySettings,
    defaultCalendarId: s.defaultCalendarId,
    defaultSuggestionCategories: s.defaultSuggestionCategories,
    appearance: s.appearance,
    uiLanguage: s.uiLanguage,
    onboardingCompletedAt: s.onboardingCompletedAt,
    diagnostics: s.diagnostics,
  }
}

export type BootHydrateResult = { status: 'ok' } | { status: 'config-corrupt'; error: string }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

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
    store.getState().apply(DEFAULT_SNAPSHOT)
    // Keep the diagnostics redaction comparator in sync with configured keys.
    setHttpCallKnownSecretValues(DEFAULT_SNAPSHOT.providers.map((p) => p.apiKey))
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

  store.getState().apply({ ...config, diagnostics })
  setHttpCallKnownSecretValues(config.providers.map((p) => p.apiKey))
  return { status: 'ok' }
}

export const appSettingsStore = {
  useAppSettings,
  getAppSettings,
  __reset: store.getState().__reset,
}

export type { AppSettingsSnapshot, AppSettingsState }
