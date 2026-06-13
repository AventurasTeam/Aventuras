import { appSettingsStore, hydrateAppSettings } from './app-settings/app-settings'
import { readAppSettingsRow, rehydrateAppSettings } from './app-settings/app-settings-read'
import { chaptersStore } from './chapters/chapters'
import { characterRelationshipsStore } from './character-relationships/character-relationships'
import { entitiesStore } from './entities/entities'
import { entriesStore } from './entries/entries'
import { entryAssetsStore } from './entry-assets/entry-assets'
import { eraFlipsStore } from './era-flips/era-flips'
import { generationStore } from './generation/generation'
import { happeningAwarenessStore } from './happenings/awareness'
import { happeningsStore } from './happenings/happenings'
import { happeningInvolvementsStore } from './happenings/involvements'
import { loreStore } from './lore/lore'
import { navigationStore } from './navigation/navigation'
import { threadsStore } from './threads/threads'
import { translationsStore } from './translations/translations'

// Test-harness seam: resets every domain store in one call
export function resetAllStores(): void {
  chaptersStore.__reset()
  characterRelationshipsStore.__reset()
  entitiesStore.__reset()
  entriesStore.__reset()
  entryAssetsStore.__reset()
  eraFlipsStore.__reset()
  generationStore.__reset()
  happeningAwarenessStore.__reset()
  happeningInvolvementsStore.__reset()
  happeningsStore.__reset()
  loreStore.__reset()
  threadsStore.__reset()
  translationsStore.__reset()
  navigationStore.__reset()
  appSettingsStore.__reset()
}

export {
  appSettingsStore,
  chaptersStore,
  characterRelationshipsStore,
  entitiesStore,
  entriesStore,
  entryAssetsStore,
  eraFlipsStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  hydrateAppSettings,
  loreStore,
  navigationStore,
  readAppSettingsRow,
  rehydrateAppSettings,
  threadsStore,
  translationsStore,
}

export { createWorkingSetStore } from './factory/working-set-store'

export type { AppSettingsSnapshot, BootHydrateResult } from './app-settings/app-settings'
export type { RelationshipView } from './character-relationships/character-relationships'
export type { WorkingSetStore } from './factory/working-set-store'
export { isUserEditBlocked } from './generation/generation'
export type { RunState, TxState } from './generation/generation'
export type { NavigationSnapshot } from './navigation/navigation'
