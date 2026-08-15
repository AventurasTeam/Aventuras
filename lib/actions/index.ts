export {
  embedClassifierDescriptions,
  readClassifierStatus,
  recordClassifierPreflightFailure,
  resetStuckClassifierRunState,
  unprocessedTurnCount,
} from './classifier/deps'
export { runClassifierNow } from './classifier/run-now'
export { defineAction } from './define-action'
// The raw engine primitives (startSwap / resumeSwap / cancelSwap / reindexStory /
// relabelModel) are deliberately absent: each requires the caller to already hold
// the per-story single-flight lock, and the safe entry points are the *Story*
// wrappers that take it via runExclusive. They stay reachable inside
// `./embedder-swap` only, so the unsafe pair is never the more obvious import.
export {
  buildDrainController,
  cancelStorySwap,
  composeRetrievalEmbedDeps,
  kickStoryDrain,
  countStoryEmbeddableRows,
  refreshEmbeddingStatus,
  reindexStoryNow,
  relabelStory,
  RelabelBlockedError,
  RelabelDimMismatchError,
  resolveDrainConfig,
  resolveStorySwapConfig,
  resumeStorySwap,
  setDrainKickSink,
  setDrainStatusSink,
  startStorySwap,
  SwapBusyError,
  SwapConfigError,
  SwapInProgressError,
  SwapMarkerChangedError,
  SwapNotInProgressError,
  SwapStoryMissingError,
  type StoryEmbedderActionRejection,
  type SwapCancelOutcome,
} from './embedder-swap'
export { applyDeltaAction } from './delta/apply-delta-action'
export { applyUndoPayload, computeUndoPayload } from './delta/delta-encoding'
export { __resetRegistrationGuard, registerAllDomains } from './delta/registrations'
export { __resetRegistry, type StorePatch } from './delta/registry'
export { type RedoSnapshot } from './delta/redo'
export { DeltaReplayError, reverseReplayDeltas } from './delta/reverse-replay'
export {
  addProvider,
  ensureProviderEmbeddingDim,
  normalizeAppSettingsRow,
  probeProviderEmbeddingDim,
  quickWireModel,
  recordProviderEmbeddingDim,
  resetAppSettings,
  setAppearanceThemeId,
  setAssignments,
  setDebugLevelEnabled,
  setDefaultProvider,
  setDiagnosticsEnabled,
  setEmbedderDefaults,
  updateProvider,
  upsertProfile,
} from './settings'
export type { SettingsActionCtx } from './settings'
export {
  createStoryWithBranch,
  type CreateStoryInput,
  type WizardCastEntityInput,
} from './stories/create-story'
export { deleteStory } from './stories/delete-story'
export { resetStorySettings } from './stories/reset-settings'
export {
  StorySettingsStaleStoreError,
  updateStorySettings,
  type UpdateStorySettingsResult,
} from './stories/update-story-settings'
export {
  loadOpenStory,
  openStory,
  setStoryArchived,
  setStoryFavorite,
  touchStoryOpened,
  type LoadOpenStoryResult,
  type OpenStoryResult,
} from './stories/operational'
export {
  getRollbackCounts,
  rollbackToEntry,
  updateStoryEntryContent,
  type RollbackCounts,
  type StoryEntryRejection,
} from './story-entries/operational'
export { bracketProseReversal, classifierWatermarkClampOps } from './story-entries/prose-reversal'
export { ENTRIES_WINDOW_SIZE, readRecentEntries } from './story-entries/recent-window'
export { STORY_ENTRY_REJECTION, type StoryEntryRejectionCode } from './story-entries/register'
export { redoLastAction, undoLastAction, type UndoResult } from './story-entries/undo'
export { clearSystemEntry, writeSystemEntry } from './story-entries/system-entry'
export { refreshSuggestions } from './suggestions/refresh-suggestions'
export { regenerateTurn, type RegenerateTurnResult } from './turns/regenerate-turn'
export { submitTurn, type SubmitTurnMeta } from './turns/submit-turn'
export type { DbCtx, DeltaSource, MutationResult, PipelineAction } from './types'
export {
  clearLiveSession,
  loadDraft,
  loadLiveSession,
  saveLiveSession,
  saveStoryDraft,
  sessionExists,
} from './wizard/session'
