import { appSettingsStore, hydrateAppSettings } from './app-settings/app-settings'
import { readAppSettingsRow, rehydrateAppSettings } from './app-settings/app-settings-read'
import { generationStore } from './generation/generation'
import { navigationStore } from './navigation/navigation'

// Test-harness seam: resets every domain store in one call
export function resetAllStores(): void {
  generationStore.__reset()
  navigationStore.__reset()
  appSettingsStore.__reset()
}

export {
  appSettingsStore,
  generationStore,
  hydrateAppSettings,
  navigationStore,
  readAppSettingsRow,
  rehydrateAppSettings,
}

export { createWorkingSetStore } from './factory/working-set-store'

export type { AppSettingsSnapshot, BootHydrateResult } from './app-settings/app-settings'
export type { WorkingSetStore } from './factory/working-set-store'
export type { RunState, TxState } from './generation/generation'
export type { NavigationSnapshot } from './navigation/navigation'
