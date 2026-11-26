import { appSettingsStore, hydrateAppSettings } from './app-settings/app-settings'
import { rehydrateAppSettings } from './app-settings/app-settings-read'
import { branchesStore } from './branches/branches'
import { chaptersStore } from './chapters/chapters'
import { characterRelationshipsStore } from './character-relationships/character-relationships'
import { currentStoryStore } from './current-story/current-story'
import { entitiesStore } from './entities/entities'
import { entriesStore } from './entries/entries'
import { eraFlipsStore } from './era-flips/era-flips'
import { generationStore } from './generation/generation'
import { happeningAwarenessStore } from './happenings/awareness'
import { happeningsStore } from './happenings/happenings'
import { happeningInvolvementsStore } from './happenings/involvements'
import { loreStore } from './lore/lore'
import { navigationStore } from './navigation/navigation'
import { readStoryChapterNumbers, rehydrateStories, storiesStore } from './stories/stories'
import { threadsStore } from './threads/threads'
import { translationsStore } from './translations/translations'
import { blockingOverlaysStore, useRegisteredOverlay } from './ui/blocking-overlays'
import {
  chapterOverlaysStore,
  overlayChapter,
  reportChapter,
  reviewWindowChapter,
  useCloseResultChapter,
  useRerunConfirmChapter,
} from './ui/chapter-overlays'
import { embedderSwapStore } from './ui/embedder-swap'
import { embeddingStatusStore } from './ui/embedding-status'
import { listCollapseStore } from './ui/list-collapse'
import { readerHoldStore } from './ui/reader-hold'
import { readerRailStore } from './ui/reader-rail'
import { recoveryReportStore } from './ui/recovery-report'
import { undoRedoStore } from './ui/undo-redo'
import { CAST_ID_PREFIX, wizardStore } from './wizard/wizard'

// Test-harness seam: resets every domain store in one call
export function resetAllStores(): void {
  branchesStore.__reset()
  chaptersStore.__reset()
  characterRelationshipsStore.__reset()
  currentStoryStore.__reset()
  entitiesStore.__reset()
  entriesStore.__reset()
  eraFlipsStore.__reset()
  generationStore.__reset()
  happeningAwarenessStore.__reset()
  happeningInvolvementsStore.__reset()
  happeningsStore.__reset()
  loreStore.__reset()
  storiesStore.__reset()
  threadsStore.__reset()
  translationsStore.__reset()
  navigationStore.__reset()
  appSettingsStore.__reset()
  embedderSwapStore.__reset()
  embeddingStatusStore.__reset()
  blockingOverlaysStore.__reset()
  chapterOverlaysStore.__reset()
  listCollapseStore.__reset()
  readerHoldStore.__reset()
  readerRailStore.__reset()
  recoveryReportStore.__reset()
  undoRedoStore.__reset()
  wizardStore.reset()
}

export {
  appSettingsStore,
  blockingOverlaysStore,
  CAST_ID_PREFIX,
  chapterOverlaysStore,
  chaptersStore,
  characterRelationshipsStore,
  currentStoryStore,
  embedderSwapStore,
  embeddingStatusStore,
  entitiesStore,
  entriesStore,
  eraFlipsStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  hydrateAppSettings,
  listCollapseStore,
  loreStore,
  navigationStore,
  overlayChapter,
  readerRailStore,
  readStoryChapterNumbers,
  recoveryReportStore,
  rehydrateAppSettings,
  rehydrateStories,
  reportChapter,
  reviewWindowChapter,
  storiesStore,
  threadsStore,
  translationsStore,
  undoRedoStore,
  useCloseResultChapter,
  useRegisteredOverlay,
  useRerunConfirmChapter,
  wizardStore,
}

export { closeReportFields } from './chapters/chapter-store-projection'
export { createWorkingSetStore } from './factory/working-set-store'
export {
  branchesStore,
  readStoryBranches,
  readStoryCurrentBranchId,
  refreshBranches,
  type BranchRow,
} from './branches/branches'

export { openEmbedderSwapDialog } from './ui/embedder-swap'
export { readerHoldStore, type ReaderHoldToken } from './ui/reader-hold'

export type { AppSettingsSnapshot, BootHydrateResult } from './app-settings/app-settings'
export type { StoreChapter } from './chapters/chapters'
export type { RelationshipView } from './character-relationships/character-relationships'
export type { OpenStory } from './current-story/current-story'
export type { WorkingSetStore } from './factory/working-set-store'
export {
  awaitRunTerminal,
  cancelStoryRuns,
  interruptMemoryRuns,
  isBranchHeld,
  isAnyStoryBranchBusy,
  isHeadReversalBlocked,
  isStoryBusy,
  isUserEditBlocked,
  RERUN_HELD,
  runBlocksHeadReversal,
  selectMemoryRun,
} from './generation/generation'
export { refreshHeldByRerun, rerunHoldsReversal } from './generation/rerun-holds'
export type {
  CloseProgress,
  DeferredWork,
  DeferredWorkKind,
  HeldBranch,
  PendingClose,
  PendingMark,
  PendingRerun,
  PendingTurn,
  RunSlot,
  RunState,
  TxState,
} from './generation/generation'
export type { NavigationSnapshot } from './navigation/navigation'
export type { OpenFailure, OpenFailureKind, StoriesSnapshot } from './stories/stories'
export type { RecoveryReportSnapshot } from './ui/recovery-report'
export type {
  ChapterOverlaysState,
  CloseModalRequest,
  CloseResult,
  OverlaySurface,
  RerunConfirmRequest,
  ReviewRequest,
} from './ui/chapter-overlays'
export type { StoryCardData } from './stories/view-model'
export type { StoryFilter, StoryListQuery, StorySort } from './stories/selectors'
export { selectStoryCards } from './stories/selectors'
export { toStoryCardData } from './stories/view-model'
