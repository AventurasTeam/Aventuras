export { defineAction } from './define-action'
export { applyDeltaAction } from './delta/apply-delta-action'
export { applyUndoPayload, computeUndoPayload } from './delta/delta-encoding'
export { registerAllDomains, __resetRegistrationGuard } from './delta/registrations'
export { __resetRegistry, type StorePatch } from './delta/registry'
export { DeltaReplayError, reverseReplayDeltas } from './delta/reverse-replay'
export { resetAppSettings, setDebugLevelEnabled, setDiagnosticsEnabled } from './settings'
export type { SettingsActionCtx } from './settings'
export {
  getRollbackCounts,
  rollbackToEntry,
  updateStoryEntryContent,
  type RollbackCounts,
  type StoryEntryRejection,
} from './story-entries/operational'
export { STORY_ENTRY_REJECTION, type StoryEntryRejectionCode } from './story-entries/register'
export type { DbCtx, DeltaSource, MutationResult, PipelineAction } from './types'
