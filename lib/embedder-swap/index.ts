// Engine primitives aren't re-exported: each assumes the caller holds the per-story admission
// lock, which only the app-deps wrappers take. Import from './engine' inside this module only.
export {
  RelabelDimMismatchError,
  SwapInProgressError,
  SwapMarkerChangedError,
  SwapNotInProgressError,
  SwapStoryMissingError,
  type SwapDeps,
  type SwapParams,
} from './engine'

export {
  buildDrainController,
  cancelStorySwap,
  composeRetrievalEmbedDeps,
  kickStoryDrain,
  countStoryEmbeddableRows,
  embedClassifierDescriptions,
  isStorySwapPending,
  refreshEmbeddingStatus,
  reindexStoryNow,
  relabelStory,
  resolveDrainConfig,
  resolveStorySwapConfig,
  RelabelBlockedError,
  resumeStorySwap,
  setDrainKickSink,
  setDrainStatusSink,
  startStorySwap,
  withTurnAdmission,
  SwapBusyError,
  SwapConfigError,
  type StoryEmbedderActionRejection,
  type TurnAdmissionResult,
  type SwapCancelOutcome,
} from './app-deps'
