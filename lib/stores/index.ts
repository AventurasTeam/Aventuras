import { appSettings } from './domain/app-settings'
import { generation } from './domain/generation'
import { navigation } from './domain/navigation'

// Namespaced public API. Raw store handles (generationStore, appSettingsStore,
// navigationStore) are never exported — the namespace shape is what prevents
// setState from outside the module.
export const domain = {
  // generation (Slice 1.5a)
  useGeneration: generation.useGeneration,
  getTxState: generation.getTxState,
  getPerTurnContext: generation.getPerTurnContext,
  setActiveRun: generation.setActiveRun,
  clearActiveRun: generation.clearActiveRun,
  startRun: generation.startRun,
  setCurrentPhase: generation.setCurrentPhase,
  recordPhaseResult: generation.recordPhaseResult,
  finishRun: generation.finishRun,
  abortRun: generation.abortRun,
  // app-settings read-model (Slice 1.6)
  useAppSettings: appSettings.useAppSettings,
  getAppSettings: appSettings.getAppSettings,
  // navigation (Slice 1.6)
  useNavigation: navigation.useNavigation,
  getNavigation: navigation.getNavigation,
  setCurrentStory: navigation.setCurrentStory,
  setCurrentBranch: navigation.setCurrentBranch,
  // Test seam: resets every domain store (pipeline harness calls domain.__reset).
  __reset: () => {
    generation.__reset()
    appSettings.__reset()
    navigation.__reset()
  },
}

export const ui = {}

export { hydrateAppSettings } from './domain/app-settings'
export { readAppSettingsRow, rehydrateAppSettings } from './domain/app-settings-read'

export type { PerTurnContext, RunState, TxState } from './domain/generation'
export type { AppSettingsSnapshot, BootHydrateResult } from './domain/app-settings'
export type { NavigationSnapshot } from './domain/navigation'
